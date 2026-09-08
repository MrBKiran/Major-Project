"""
LangGraph Master Agent – PLAN → DISPATCH → OBSERVE → RE-PLAN → CLOSE
"""
import uuid, logging, json
from datetime import datetime
from typing import TypedDict, Annotated
from langgraph.graph import StateGraph, END
from app.ueba.engine import evaluate_call
from app.ml.models import ml_service
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("master_agent")

# ── State ─────────────────────────────────────────────────────────────────────

class AgentState(TypedDict):
    run_id: str
    vin: str
    telemetry: dict
    plan: list[str]
    current_step: int
    results: dict
    status: str
    replans: int
    events: list[dict]

# ── Worker stubs (real workers call LLM + tools) ──────────────────────────────

def _data_analysis(state: AgentState) -> dict:
    telem = state["telemetry"]
    health = ml_service.predict_health(telem)
    anomaly = ml_service.anomaly_score([
        telem.get("coolant_temp", 90),
        telem.get("oil_pressure", 35),
        telem.get("battery_voltage", 12.4),
        telem.get("engine_load", 55),
        telem.get("rpm", 2200),
        telem.get("speed", 50),
        telem.get("fuel_level", 60),
        len(telem.get("dtc", [])),
    ])
    return {"health": health, "anomaly_score": anomaly}

def _diagnosis(state: AgentState) -> dict:
    telem = state["telemetry"]
    features = {
        "coolant_temp_trend": telem.get("coolant_temp", 90) - 85,
        "oil_pressure_trend": 0.0,
        "battery_trend": 0.0,
        "coolant_temp_max": telem.get("coolant_temp", 90),
        "oil_pressure_min": telem.get("oil_pressure", 35),
        "dtc_count_7d": len(telem.get("dtc", [])),
        "age_days": 800,
        "km_since_service": 4500,
    }
    pred = ml_service.predict_failure(features)
    component = "water_pump" if telem.get("coolant_temp", 0) > 100 else "battery"
    return {"component": component, **pred}

def _customer_engagement(state: AgentState) -> dict:
    diag = state["results"].get("diagnosis", {})
    severity = diag.get("severity", "P3")
    prob = diag.get("failure_probability", 0.2)
    component = diag.get("component", "engine")
    script = (
        f"Namaste! Your vehicle's {component} shows {prob*100:.0f}% failure risk. "
        f"Severity: {severity}. Shall we schedule a service appointment?"
    )
    return {"voice_script": script, "booking_intent": True}

def _scheduling(state: AgentState) -> dict:
    return {
        "slot_id": "SLOT_20240615_10AM",
        "center": "AutoSaarthi Bengaluru Central",
        "date": "2024-06-15",
        "time": "10:00 AM",
        "status": "held"
    }

def _feedback(state: AgentState) -> dict:
    return {"feedback_collected": False, "note": "Awaiting post-service feedback"}

WORKER_MAP = {
    "data_analysis": _data_analysis,
    "diagnosis": _diagnosis,
    "customer_engagement": _customer_engagement,
    "scheduling": _scheduling,
    "feedback": _feedback,
}

# ── Graph nodes ───────────────────────────────────────────────────────────────

def plan_node(state: AgentState) -> AgentState:
    telem = state["telemetry"]
    coolant = telem.get("coolant_temp", 85)
    if coolant > 105:
        plan = ["data_analysis", "diagnosis", "customer_engagement", "scheduling", "feedback"]
    else:
        plan = ["data_analysis", "diagnosis"]
    state["plan"] = plan
    state["current_step"] = 0
    state["events"].append({"type": "PLAN", "plan": plan, "ts": datetime.utcnow().isoformat()})
    logger.info(f"[{state['run_id']}] Plan: {plan}")
    return state

def dispatch_node(state: AgentState) -> AgentState:
    step = state["current_step"]
    if step >= len(state["plan"]):
        state["status"] = "closing"
        return state

    worker_name = state["plan"][step]
    agent_name = f"{worker_name}_agent"

    ueba_result = evaluate_call(state["run_id"], agent_name, f"{worker_name}.run", {})
    state["events"].append({
        "type": "DISPATCH",
        "worker": worker_name,
        "ueba": ueba_result["decision"],
        "risk": ueba_result["risk_score"],
        "ts": datetime.utcnow().isoformat()
    })

    if ueba_result["decision"] == "BLOCK":
        state["events"].append({"type": "BLOCK", "worker": worker_name,
                                "reason": ueba_result["reason"],
                                "ts": datetime.utcnow().isoformat()})
        if state["replans"] < 2:
            state["replans"] += 1
            state["plan"].pop(step)  # skip blocked worker
            state["status"] = "replanning"
        else:
            state["status"] = "closing"
        return state

    fn = WORKER_MAP.get(worker_name)
    if fn:
        result = fn(state)
        state["results"][worker_name] = result
        state["events"].append({"type": "RESULT", "worker": worker_name,
                                "result": result, "ts": datetime.utcnow().isoformat()})

    state["current_step"] += 1
    state["status"] = "dispatching"
    return state

def observe_node(state: AgentState) -> AgentState:
    last = state["events"][-1] if state["events"] else {}
    if last.get("type") == "RESULT":
        state["status"] = "dispatching"
    return state

def close_node(state: AgentState) -> AgentState:
    state["status"] = "closed"
    state["events"].append({"type": "CLOSE", "results": state["results"],
                            "ts": datetime.utcnow().isoformat()})
    logger.info(f"[{state['run_id']}] Run closed. Steps: {state['current_step']}")
    return state

def router(state: AgentState) -> str:
    if state["status"] == "closing":
        return "close"
    if state["status"] == "replanning":
        return "plan"
    if state["current_step"] >= len(state["plan"]):
        return "close"
    return "dispatch"

# ── Build graph ───────────────────────────────────────────────────────────────

def build_graph():
    g = StateGraph(AgentState)
    g.add_node("plan", plan_node)
    g.add_node("dispatch", dispatch_node)
    g.add_node("observe", observe_node)
    g.add_node("close", close_node)
    g.set_entry_point("plan")
    g.add_edge("plan", "dispatch")
    g.add_edge("dispatch", "observe")
    g.add_conditional_edges("observe", router, {"plan": "plan", "dispatch": "dispatch", "close": "close"})
    g.add_edge("close", END)
    return g.compile()

graph = build_graph()

async def run_master_agent(vin: str, telemetry: dict) -> dict:
    run_id = str(uuid.uuid4())[:8]
    initial_state: AgentState = {
        "run_id": run_id,
        "vin": vin,
        "telemetry": telemetry,
        "plan": [],
        "current_step": 0,
        "results": {},
        "status": "planning",
        "replans": 0,
        "events": [],
    }
    final = graph.invoke(initial_state)
    return {"run_id": run_id, "vin": vin, "events": final["events"], "results": final["results"]}
