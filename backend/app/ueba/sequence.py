"""
UEBA Layer C — sequence / intent deviation.

Compares what an agent actually does against the Master Agent's declared plan,
and screens free-text arguments for injected instructions. An LLM adjudicator
can be layered on top (see adjudicate()), but the deterministic checks below
are what fire during the demo — they are fast and never rate-limited.
"""

from __future__ import annotations

import re
from collections import defaultdict, deque

_history: dict[str, deque] = defaultdict(lambda: deque(maxlen=50))

# Prompt-injection surface. ATTACK-3 arrives here via the VOICE transcript.
_INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior|above)\s+instructions?",
    r"disregard\s+(your|all|the)\s+(rules|instructions|policy|guardrails)",
    r"you\s+are\s+now\s+(a|an|the)\s+",
    r"\bsystem\s*prompt\b",
    r"cancel\s+all\s+(appointments?|bookings?)",
    r"delete\s+all\b",
    r"for\s+every\s+(vehicle|customer|vin)\b",
    r"reveal\s+(your|the)\s+(prompt|instructions|api[_ ]?key)",
    r"\bsudo\b|\broot\s+access\b",
    r"act\s+as\s+(the\s+)?(master|admin|administrator)",
]
_COMPILED = [re.compile(p, re.I) for p in _INJECTION_PATTERNS]

_FREE_TEXT_KEYS = {"utterance", "text", "message", "transcript", "query",
                   "verbatim", "prompt", "note", "notes", "question", "answer"}


# Repeated injection attempts per agent. A single rejected injection is the
# guard working; a stream of them is someone probing, which is a different
# finding and does deserve taking the agent offline. See `note_injection`.
_injection_attempts: dict[str, int] = defaultdict(int)
INJECTION_QUARANTINE_AFTER = 3


def note_injection(agent_id: str) -> int:
    """Record one rejected injection against `agent_id`; return the running count."""
    _injection_attempts[agent_id] += 1
    return _injection_attempts[agent_id]


def detect_injection(args: dict) -> tuple[float, str]:
    for k, v in args.items():
        if k.lower() not in _FREE_TEXT_KEYS or not isinstance(v, str):
            continue
        for pat in _COMPILED:
            if (m := pat.search(v)):
                return 1.0, (f"prompt injection in '{k}': matched /{pat.pattern}/ "
                             f"→ \"{m.group(0)[:60]}\"")
    return 0.0, ""


def score(spec, args, ctx) -> tuple[float, str, bool]:
    """Returns (graded_score, detail, hard_block).

    Prompt injection is returned as a hard block rather than folded into the
    graded score. Layer C carries only 0.2 of the fused risk, so a perfect
    injection match scores 0.2 — below even the FLAG threshold — and would
    always be allowed through. A regex-confirmed injection is a deterministic
    finding like a policy violation, not a shade of "unusual", so it bypasses
    the weighted fusion the way Layer A's hard_block does.
    """
    from app.ueba.policy import engine  # local import avoids cycle

    a = args.model_dump() if hasattr(args, "model_dump") else dict(args)
    hits: list[str] = []
    s = 0.0

    # 1. prompt injection (ATTACK-3)
    inj, detail = detect_injection(a)
    hard = False
    if inj:
        s = max(s, 1.0)
        hits.append(detail)
        # `prompt_injection_guard` marks the agents whose inputs an attacker can
        # reach (the voice/chat surface). Default on: injected instructions are
        # never legitimate in any agent's arguments.
        hard = bool(engine.agent_cfg(ctx.agent_id).get("prompt_injection_guard", True))

    # 2. plan deviation — is this tool part of what the Master declared?
    plan = engine.scope.plans.get(ctx.run_id)
    if plan and spec.name not in plan and spec.side_effect != "read":
        s = max(s, 0.6)
        hits.append(f"'{spec.name}' is not in the declared plan for run {ctx.run_id}")

    # 3. repetition without progress — same tool, same args, 5×
    key = f"{ctx.agent_id}|{spec.name}"
    recent = list(_history[key])[-5:]
    sig = str(sorted(a.items()))
    if len(recent) == 5 and all(r == sig for r in recent):
        s = max(s, 0.45)
        hits.append(f"'{spec.name}' repeated 5× with identical arguments (stuck or probing)")

    return s, ("; ".join(hits) if hits else "consistent with plan"), hard


def record(spec, args, ctx) -> None:
    a = args.model_dump() if hasattr(args, "model_dump") else dict(args)
    _history[f"{ctx.agent_id}|{spec.name}"].append(str(sorted(a.items())))


async def adjudicate(spec, args, ctx, reasons: list[dict]) -> dict:
    """
    Optional LLM second opinion for ambiguous cases. Kept off the hot path:
    call it only when the deterministic score lands in the FLAG band.
    """
    from app.llm.router import complete_json  # noqa: PLC0415

    prompt = (
        "You are a security adjudicator for an autonomous multi-agent system.\n"
        f"Agent: {ctx.agent_id}\nTool: {spec.name}\n"
        f"Declared plan: {ctx.model_dump().get('plan')}\n"
        f"Deterministic findings: {reasons}\n"
        "Return JSON: {\"verdict\":\"benign|suspicious|malicious\","
        "\"severity\":0.0-1.0,\"reason\":\"one sentence\"}"
    )
    try:
        return await complete_json(prompt, max_tokens=180)
    except Exception as e:  # noqa: BLE001
        return {"verdict": "unknown", "severity": 0.0, "reason": f"adjudicator unavailable: {e}"}


def reset() -> None:
    _history.clear()
    _injection_attempts.clear()
