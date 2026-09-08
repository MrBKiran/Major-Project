"""
UEBA — the guard. Fuses all three detection layers into one decision.

    risk = 0.5·policy + 0.3·(1 − iso_norm) + 0.2·llm_severity

    risk < 0.40          → ALLOW  (log only)
    0.40 ≤ risk < 0.70   → FLAG   (execute, but red-banner it)
    risk ≥ 0.70          → BLOCK  (deny, quarantine, Master re-plans)

Bound into tools/registry.invoke() at startup, so no agent can route around it.
"""

from __future__ import annotations

import time
from typing import Any

from app.events import bus
from app.ueba import baseline, sequence
from app.ueba.audit import audit
from app.ueba.policy import engine


def _weights() -> dict:
    w = (engine.scoring or {}).get("weights") or {}
    return {"policy": w.get("policy", 0.5), "baseline": w.get("baseline", 0.3), "sequence": w.get("sequence", 0.2)}


def _thresholds() -> tuple[float, float]:
    t = (engine.scoring or {}).get("thresholds") or {}
    return float(t.get("allow_below", 0.40)), float(t.get("block_at", 0.70))


async def ueba_guard(spec, args, ctx) -> tuple[str, float, list[dict]]:
    """
    Returns (decision, risk, reasons). Called for EVERY tool invocation.
    Must never raise — a crashing guard would fail open.
    """
    t0 = time.perf_counter()
    reasons: list[dict] = []
    w = _weights()

    # ── Layer A · policy (deterministic) ────────────────────────────────
    try:
        verdict = engine.evaluate(spec, args, ctx)
        policy_score = verdict.score
        hard_block = verdict.hard_block
        policy_hard = verdict.hard_block
        reasons += verdict.reasons()
    except Exception as e:  # noqa: BLE001
        policy_score, hard_block, policy_hard = 0.0, False, False
        reasons.append({"layer": "A", "rule": "engine_error", "detail": str(e), "action": "FLAG"})

    # ── Layer B · behavioural baseline (IsolationForest) ────────────────
    try:
        b_score, b_detail = baseline.score(spec, args, ctx)
        if b_score > 0.0:
            reasons.append({"layer": "B", "rule": "behavioural_anomaly", "detail": b_detail,
                            "action": "FLAG", "score": round(b_score, 3)})
    except Exception as e:  # noqa: BLE001
        b_score, b_detail = 0.0, f"baseline unavailable: {e}"

    # ── Layer C · sequence / intent deviation ───────────────────────────
    try:
        c_score, c_detail, c_hard = sequence.score(spec, args, ctx)
        if c_score > 0.0:
            reasons.append({
                "layer": "C",
                "rule": "prompt_injection" if c_hard else "plan_deviation",
                "detail": c_detail,
                "action": "BLOCK" if c_hard else "FLAG",
                "score": round(c_score, 3),
            })
        hard_block = hard_block or c_hard
        injection_hard = c_hard
    except Exception as e:  # noqa: BLE001
        c_score, c_detail, injection_hard = 0.0, f"sequence unavailable: {e}", False

    # ── fuse ────────────────────────────────────────────────────────────
    risk = w["policy"] * policy_score + w["baseline"] * b_score + w["sequence"] * c_score
    risk = min(1.0, round(risk, 4))

    allow_below, block_at = _thresholds()
    if hard_block:
        decision, risk = "BLOCK", max(risk, 0.85)   # a hard policy hit always blocks
    elif risk >= block_at:
        decision = "BLOCK"
    elif risk >= allow_below:
        decision = "FLAG"
    else:
        decision = "ALLOW"

    # ── quarantine + audit ──────────────────────────────────────────────
    #
    # Not every BLOCK means the agent misbehaved. A prompt injection caught in
    # an argument the *customer* supplied means the guard did its job and the
    # agent never acted on it — the agent is the thing being attacked, not the
    # attacker. Quarantining it there would turn a successfully-defended attack
    # into a successful denial of service: on a live chat surface one hostile
    # message would take the assistant offline for every other owner for the
    # full quarantine window. So a rejected injection blocks the call and is
    # audited, but only takes the agent down once it is clearly systematic
    # rather than a one-off.
    #
    # Every other BLOCK — scope violation, rate limit, off-hours write,
    # behavioural anomaly — is the agent itself acting out of character, and
    # still quarantines immediately (ATTACK-1's "Master must re-plan" path).
    if decision == "BLOCK":
        injection_only = injection_hard and not policy_hard
        attempts = sequence.note_injection(ctx.agent_id) if injection_only else 0
        if injection_only and attempts < sequence.INJECTION_QUARANTINE_AFTER:
            reasons.append({
                "layer": "-", "rule": "injection_rejected",
                "detail": (f"hostile input refused (attempt {attempts}/"
                           f"{sequence.INJECTION_QUARANTINE_AFTER}); agent left in service — "
                           f"it never executed the injected instruction"),
                "action": "BLOCK",
            })
        else:
            secs = engine.quarantine(ctx.agent_id)
            reasons.append({"layer": "-", "rule": "quarantine",
                            "detail": f"{ctx.agent_id} quarantined for {secs}s; Master must re-plan",
                            "action": "BLOCK"})

    from app.tools.registry import _redact, args_hash  # local import avoids cycle

    row = audit.append(
        run_id=ctx.run_id,
        agent_id=ctx.agent_id,
        tool=spec.name,
        decision=decision,
        risk_score=risk,
        reasons=reasons,
        args_hash=args_hash(args),
        args_redacted=_redact(args.model_dump() if hasattr(args, "model_dump") else dict(args)),
        latency_ms=round((time.perf_counter() - t0) * 1000, 2),
    )

    if decision != "ALLOW":
        await bus.emit({
            "type": "ueba_alert",
            "severity": decision,
            "run_id": ctx.run_id,
            "agent_id": ctx.agent_id,
            "agent_name": engine.agent_cfg(ctx.agent_id).get("display_name", ctx.agent_id),
            "tool": spec.name,
            "risk": risk,
            "components": {"policy": round(policy_score, 3), "baseline": round(b_score, 3),
                           "sequence": round(c_score, 3)},
            "reasons": reasons,
            "audit_seq": row["seq"],
            "row_hash": row["row_hash"][:12],
            "ts": time.time(),
        })

    baseline.record(spec, args, ctx, decision)
    sequence.record(spec, args, ctx)
    return decision, risk, reasons


def install() -> None:
    """Bind the guard into the tool registry. Call once at startup."""
    from app.tools import registry

    registry.bind_guard(ueba_guard)
    registry.bind_event_sink(bus.emit)
