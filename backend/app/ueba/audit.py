"""
UEBA — tamper-evident audit log.

Every tool call, allowed or blocked, lands here. Rows are hash-chained:
    row_hash = SHA256(prev_hash || canonical_json(payload))

Any retroactive edit or deletion breaks the chain, and /api/ueba/verify-chain
returns the first bad index. Fifteen lines of code, one very good slide.

Storage: append-only JSONL on disk (demo) + Postgres agent_audit (production).
The JSONL is what you `tail -f` on stage.

Concurrency note — read before touching this file again: `append()` acquires
an OS-level lock (filelock, cross-process) and re-reads the tail hash from
disk INSIDE that lock, rather than trusting the `self._prev` cached at process
startup. The first version cached `_prev` once in `__init__` and only
synchronised it with a `threading.Lock`, which protects threads inside one
process and nothing else. Under a live server plus a second process touching
the same file (a second uvicorn worker in production; in dev, this module's
own test suite running against a live server that was also appending), the
cached value goes stale the instant the OTHER process appends a row: this
process's next write still claims the old, now-wrong `prev_hash`, and
`verify()` finds a broken link at exactly that point. It looks identical to
real tampering — which is the worst possible failure mode for a
tamper-evidence feature, since it can't be told apart from an actual security
incident without checking the code. `test_audit_chain_is_tamper_evident`
caught this by accident (pytest and a live uvicorn process both appending to
the same file); it should be read as a concurrency test, not a fluke.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from pathlib import Path
from typing import Any, Iterator

from filelock import FileLock

GENESIS = "0" * 64
DEFAULT_PATH = Path(__file__).resolve().parents[3] / "data" / "audit" / "agent_audit.jsonl"


def _canon(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()


def compute_hash(prev_hash: str, payload: dict) -> str:
    h = hashlib.sha256()
    h.update(prev_hash.encode())
    h.update(_canon(payload))
    return h.hexdigest()


class AuditLog:
    def __init__(self, path: Path | str = DEFAULT_PATH) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # In-process fast path: avoids a disk read for callers that only ever
        # append from one thread in one process (still correct either way,
        # since append() re-derives the truth from disk under the file lock
        # regardless of what this cache holds).
        self._lock = threading.Lock()
        # Cross-process: guards the read-tail-then-append sequence in append()
        # against every OTHER process (or worker) writing this same file.
        self._file_lock = FileLock(str(self.path) + ".lock", timeout=10)
        self._prev = self._tail_hash()
        self._n = sum(1 for _ in self._iter()) if self.path.exists() else 0

    def _iter(self) -> Iterator[dict]:
        if not self.path.exists():
            return
        with open(self.path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    yield json.loads(line)

    def _tail_hash(self) -> str:
        last = GENESIS
        for row in self._iter():
            last = row.get("row_hash", last)
        return last

    # -- write -----------------------------------------------------------

    def append(
        self,
        *,
        run_id: str,
        agent_id: str,
        tool: str,
        decision: str,
        risk_score: float,
        reasons: list[dict] | None = None,
        args_hash: str = "",
        args_redacted: dict | None = None,
        latency_ms: float | None = None,
    ) -> dict:
        # threading.Lock first (cheap, orders this process's own threads),
        # filelock second (orders this process against every other one). Both
        # are held for the whole read-tail -> compute -> append sequence, or
        # two writers can still interleave between "read the current tail"
        # and "append assuming it's still current" — the exact race this
        # exists to close.
        with self._lock, self._file_lock:
            prev = self._tail_hash()          # ground truth, not the cache
            seq = sum(1 for _ in self._iter())

            payload: dict[str, Any] = {
                "seq": seq,
                "ts": round(time.time(), 3),
                "run_id": run_id,
                "agent_id": agent_id,
                "tool": tool,
                "decision": decision,
                "risk_score": round(float(risk_score), 4),
                "reasons": reasons or [],
                "args_hash": args_hash,
                "args_redacted": args_redacted or {},
                "latency_ms": latency_ms,
            }
            row_hash = compute_hash(prev, payload)
            row = {**payload, "prev_hash": prev, "row_hash": row_hash}
            with open(self.path, "a", encoding="utf-8") as f:
                f.write(json.dumps(row, default=str) + "\n")
                f.flush()
            self._prev = row_hash             # best-effort cache for callers
            self._n = seq + 1                 # that only read it, e.g. stats()
        return row

    # -- read / verify ---------------------------------------------------

    def tail(self, n: int = 100) -> list[dict]:
        rows = list(self._iter())
        return rows[-n:]

    def verify(self) -> dict:
        """Walk the chain. Returns {valid, rows, broken_at, expected, found}."""
        prev = GENESIS
        for i, row in enumerate(self._iter()):
            payload = {k: v for k, v in row.items() if k not in ("prev_hash", "row_hash")}
            expected = compute_hash(prev, payload)
            if row.get("prev_hash") != prev or row.get("row_hash") != expected:
                return {
                    "valid": False,
                    "rows": i,
                    "broken_at": i,
                    "expected": expected,
                    "found": row.get("row_hash"),
                }
            prev = row["row_hash"]
        return {"valid": True, "rows": self._n, "broken_at": None, "head": prev}

    def stats(self) -> dict:
        rows = list(self._iter())
        by_decision: dict[str, int] = {}
        by_agent: dict[str, int] = {}
        for r in rows:
            by_decision[r["decision"]] = by_decision.get(r["decision"], 0) + 1
            by_agent[r["agent_id"]] = by_agent.get(r["agent_id"], 0) + 1
        return {
            "total": len(rows),
            "by_decision": by_decision,
            "by_agent": by_agent,
            "blocked": by_decision.get("BLOCK", 0),
            "flagged": by_decision.get("FLAG", 0),
        }


audit = AuditLog()
