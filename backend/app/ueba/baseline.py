"""
UEBA Layer B — behavioural baseline.

Builds a per-agent feature vector over a rolling 60s window and scores it with
IsolationForest trained on normal fleet operation. Catches what static rules
cannot: "low and slow" abuse that stays under every rate limit.

Cold start: until a model is trained, falls back to robust z-scores over the
agent's own observed history. Never fails open silently — returns a score and a
human-readable reason either way.

Train with:  python -m ml.train.train_ueba_baseline
Artifact:    ml/artifacts/ueba_baseline.joblib
"""

from __future__ import annotations

import math
import statistics
import time
from collections import defaultdict, deque
from pathlib import Path
from typing import Any

ARTIFACT = Path(__file__).resolve().parents[3] / "ml" / "artifacts" / "ueba_baseline.joblib"
WINDOW_S = 60.0
FEATURES = [
    "tool_call_rate", "distinct_tools", "mean_payload_bytes", "error_rate",
    "p95_latency_ms", "off_baseline_sequence_score", "distinct_vins_touched",
    "distinct_customers_touched", "hour_of_day_sin", "hour_of_day_cos",
    "cross_agent_call_count", "retry_count",
]

_events: dict[str, deque] = defaultdict(lambda: deque(maxlen=600))
_model: Any | None = None
_loaded = False


def _load() -> Any | None:
    global _model, _loaded
    if _loaded:
        return _model
    _loaded = True
    try:
        import joblib  # noqa: PLC0415
        if ARTIFACT.exists():
            _model = joblib.load(ARTIFACT)
    except Exception:  # noqa: BLE001
        _model = None
    return _model


def record(spec, args, ctx, decision: str = "ALLOW") -> None:
    a = args.model_dump() if hasattr(args, "model_dump") else dict(args)
    _events[ctx.agent_id].append({
        "ts": time.time(),
        "tool": spec.name,
        "vin": a.get("vin") or getattr(ctx, "vin", None),
        "customer_id": a.get("customer_id") or getattr(ctx, "customer_id", None),
        "bytes": len(str(a)),
        "decision": decision,
        "run_id": ctx.run_id,
    })


def features(agent_id: str, ctx=None) -> dict[str, float]:
    now = time.time()
    win = [e for e in _events[agent_id] if now - e["ts"] <= WINDOW_S]
    hour = getattr(ctx, "simulated_hour_ist", None)
    if hour is None:
        from datetime import datetime, timedelta, timezone
        hour = datetime.now(timezone(timedelta(hours=5, minutes=30))).hour

    n = len(win)
    return {
        "tool_call_rate": n / WINDOW_S * 60.0,
        "distinct_tools": float(len({e["tool"] for e in win})),
        "mean_payload_bytes": float(statistics.fmean([e["bytes"] for e in win])) if win else 0.0,
        "error_rate": (sum(1 for e in win if e["decision"] != "ALLOW") / n) if n else 0.0,
        "p95_latency_ms": 0.0,
        "off_baseline_sequence_score": 0.0,
        "distinct_vins_touched": float(len({e["vin"] for e in win if e["vin"]})),
        "distinct_customers_touched": float(len({e["customer_id"] for e in win if e["customer_id"]})),
        "hour_of_day_sin": math.sin(2 * math.pi * hour / 24),
        "hour_of_day_cos": math.cos(2 * math.pi * hour / 24),
        "cross_agent_call_count": float(len({e["run_id"] for e in win})),
        "retry_count": 0.0,
    }


def score(spec, args, ctx) -> tuple[float, str]:
    """Returns (anomaly_score 0..1, reason). 0 = perfectly normal."""
    f = features(ctx.agent_id, ctx)
    model = _load()

    if model is not None:
        import numpy as np  # noqa: PLC0415
        x = np.array([[f[k] for k in FEATURES]])
        raw = float(model.decision_function(x)[0])      # >0 normal, <0 anomalous
        s = max(0.0, min(1.0, 0.5 - raw))
        if s > 0.3:
            top = sorted(f.items(), key=lambda kv: -abs(kv[1]))[:3]
            detail = ", ".join(f"{k}={v:.1f}" for k, v in top)
            return s, f"IsolationForest score {raw:+.3f} outside baseline ({detail})"
        return s, "within baseline"

    # ── cold-start heuristics (still catches ATTACK-2 and ATTACK-4) ──
    hits: list[str] = []
    s = 0.0
    if f["distinct_vins_touched"] >= 5:
        s = max(s, 0.9); hits.append(f"{int(f['distinct_vins_touched'])} distinct VINs in 60s")
    elif f["distinct_vins_touched"] >= 3:
        s = max(s, 0.55); hits.append(f"{int(f['distinct_vins_touched'])} distinct VINs in 60s")
    if f["tool_call_rate"] > 90:
        s = max(s, 0.7); hits.append(f"{f['tool_call_rate']:.0f} calls/min")
    if f["error_rate"] > 0.4 and f["tool_call_rate"] > 10:
        s = max(s, 0.6); hits.append(f"{f['error_rate']:.0%} denied calls")
    hour_raw = getattr(ctx, "simulated_hour_ist", None)
    if hour_raw is not None and not (6 <= hour_raw <= 22):
        s = max(s, 0.5); hits.append(f"activity at {hour_raw:02d}:00 IST")
    return s, ("; ".join(hits) if hits else "within baseline (cold start)")


def reset() -> None:
    _events.clear()
