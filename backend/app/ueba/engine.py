"""
UEBA – User/Entity Behaviour Analytics for AI Agents
Layer A: Policy RBAC
Layer B: IsolationForest behaviour scoring
Layer C: LLM sequence judge
"""
import hashlib, json, time, logging
from datetime import datetime
from typing import Optional
from app.ml.models import ml_service

logger = logging.getLogger("ueba")

# RBAC policy matrix: agent -> allowed tools
POLICY_MATRIX: dict[str, list[str]] = {
    "data_analysis_agent":        ["telemetry.read", "health.predict", "anomaly.detect", "demand.forecast", "data_analysis.run"],
    "diagnosis_agent":            ["failure.predict", "dtc.lookup", "maintenance.history", "diagnosis.run"],
    "customer_agent":             ["customer.profile", "voice.speak", "appointment.intent", "customer_engagement.run", "customer.run"],
    "customer_engagement_agent":  ["customer.profile", "voice.speak", "appointment.intent", "customer_engagement.run"],
    "scheduling_agent":           ["slots.list", "slots.hold", "slots.confirm", "appointment.create", "scheduling.run"],
    "feedback_agent":             ["feedback.collect", "maintenance.update", "feedback.run"],
    "manufacturing_agent":        ["cluster.failures", "capa.retrieve", "rca.generate", "capa.create", "manufacturing.run"],
    "master_agent":               ["*"],  # orchestrator has all
}

audit_log: list[dict] = []
_prev_hash = "GENESIS"

def _hash(data: str) -> str:
    return hashlib.sha256(data.encode()).hexdigest()[:16]

def _audit(run_id: str, agent: str, tool: str, args_hash: str,
           decision: str, risk: float, reason: str):
    global _prev_hash
    row = {
        "ts": datetime.utcnow().isoformat(),
        "run_id": run_id,
        "agent": agent,
        "tool": tool,
        "arguments_hash": args_hash,
        "decision": decision,
        "risk_score": risk,
        "reason": reason,
        "prev_hash": _prev_hash,
    }
    row_hash = _hash(json.dumps(row, sort_keys=True))
    row["row_hash"] = row_hash
    _prev_hash = row_hash
    audit_log.append(row)
    logger.info(f"UEBA [{decision}] {agent}->{tool} risk={risk:.2f}")
    return row

def check_policy(agent: str, tool: str) -> tuple[bool, str]:
    allowed = POLICY_MATRIX.get(agent, [])
    if "*" in allowed or tool in allowed:
        return True, "policy_allow"
    return False, f"policy_deny: {agent} not permitted to use {tool}"

def evaluate_call(run_id: str, agent: str, tool: str,
                  arguments: dict, behaviour_vector: Optional[list[float]] = None) -> dict:
    args_hash = _hash(json.dumps(arguments, sort_keys=True, default=str))

    # Layer A
    allowed, reason = check_policy(agent, tool)
    if not allowed:
        return _audit(run_id, agent, tool, args_hash, "BLOCK", 1.0, reason)

    # Layer B
    risk = 0.0
    if behaviour_vector:
        risk = ml_service.anomaly_score(behaviour_vector)
    if risk > 0.8:
        return _audit(run_id, agent, tool, args_hash, "FLAG", risk,
                      f"anomaly score {risk:.2f} exceeds threshold")

    return _audit(run_id, agent, tool, args_hash, "ALLOW", risk, "normal")

def get_audit_log(limit: int = 50) -> list[dict]:
    return audit_log[-limit:]
