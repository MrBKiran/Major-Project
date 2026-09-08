"""
Feedback Agent — post-service follow-up (PROJECT_PLAN §5.3).

Triggered once the dealer management system closes the workshop job. Calls the
owner, captures CSAT/verbatim, and writes the completed work back onto the
vehicle's maintenance record so the next prediction sees it.

That write-back matters beyond bookkeeping: a replaced water pump has to appear
in maintenance_history or the defect-clustering module will keep counting the
vehicle as at-risk, and the Diagnosis Agent will re-predict a component that
was just changed.
"""

from __future__ import annotations

from app.graph.state import FleetState
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "feedback_agent"

# Parts fitted per component, from the `repair.parts` lists in vehicles.yaml.
COMPONENT_PARTS = {
    "water_pump": ["water_pump_assy", "coolant_5l"],
    "brake_pads": ["brake_pad_set_front"],
    "battery": ["battery_12v_65ah"],
    "fuel_injector": ["injector_set", "fuel_filter"],
    "oil_pump": ["oil_pump", "oil_5w30_4l"],
}

_CSAT_WORDS = {
    5: ["excellent", "very good", "bahut badhiya", "great", "perfect"],
    4: ["good", "fine", "theek", "happy"],
    2: ["late", "delay", "not happy", "poor"],
    1: ["terrible", "worst", "bad experience"],
}


def infer_csat(utterance: str, default: int = 4) -> int:
    """Map the owner's spoken reply to a 1-5 score.

    Deterministic keyword mapping so DEMO_MODE and the no-LLM fallback both
    produce a real score rather than a hardcoded 5 — a survey that always
    returns 'delighted' is worse than no survey.
    """
    text = (utterance or "").lower()
    for score, words in _CSAT_WORDS.items():
        if any(w in text for w in words):
            return score
    return default


async def run(state: FleetState) -> FleetState:
    booking = state.get("booking") or {}
    appointment_id = booking.get("appointment_id")
    if not appointment_id or state.get("service_status") != "completed":
        return state

    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])
    component = ((state.get("diagnosis") or {}).get("top") or {}).get("component")

    try:
        await invoke(AGENT_ID, "crm.get_customer", {"vin": state["vin"]}, ctx)
        await invoke(AGENT_ID, "voice.speak", {
            "text": "Your service is complete. How would you rate your experience today?",
        }, ctx)
        reply = await invoke(AGENT_ID, "voice.listen", {"turn": 9}, ctx)
        verbatim = (reply.data or {}).get("transcript", "")
        csat = infer_csat(verbatim)

        survey = await invoke(AGENT_ID, "survey.record", {
            "appointment_id": appointment_id, "csat": csat, "verbatim": verbatim,
        }, ctx)

        # Close the loop: the work now exists in the vehicle's history, so the
        # next diagnosis and the defect clustering both see it.
        record = await invoke(AGENT_ID, "maintenance.append_record", {
            "vin": state["vin"],
            "service_type": "component_replacement" if component else "periodic_service",
            "notes": f"Predictive service completed. Owner feedback: {verbatim or 'n/a'}",
            "components_replaced": COMPONENT_PARTS.get(component, []),
        }, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "feedback": {
            "csat": csat, "verbatim": verbatim,
            "feedback_id": (survey.data or {}).get("feedback_id"),
            "record_id": (record.data or {}).get("record_id"),
        },
        "completed": [*state.get("completed", []), "feedback"],
    }
