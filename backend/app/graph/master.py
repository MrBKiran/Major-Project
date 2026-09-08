"""
AutoSaarthi — Master Agent.

plan → dispatch → observe → (re-plan) → close, every dispatch going through
`registry.invoke()` so UEBA sees everything.

Routing between phases is deterministic (§5.2: "Code decides: which node runs
next") — what's genuinely LLM-driven is the plan/re-plan *rationale* text
(via app.llm.router, DEMO_MODE-fixture-backed for now) and the persuasion
strategy content inside customer_engagement.

The re-plan step before `scheduling` is not cosmetic: `scheduler.confirm` is
side_effect=irreversible, and UEBA rule G3 blocks any irreversible tool that
isn't in the run's declared plan (app/ueba/policy.py — RunScope.in_plan()).
So extending the plan here is both "make re-planning visible" (§5.2) and the
actual mechanism that authorizes the booking to happen.
"""

from __future__ import annotations

import uuid

from langgraph.graph import END, StateGraph

from app.graph.nodes import customer_engagement, data_analysis, diagnosis, feedback, scheduling
from app.graph.state import FleetState
from app.llm.router import complete
from app.tools.registry import ToolContext, invoke

MASTER_ID = "master_agent"

INITIAL_PLAN = [
    "runs.write_plan", "runs.close",
    "telemetry.read_window", "maintenance.read_history", "ml.health_classify",
    "ml.predict_component_failure", "dtc.lookup", "crm.get_consent", "crm.get_customer",
    "llm.persuade", "voice.listen", "notify.push", "scheduler.get_slots",
]
# Only the state-changing half needs the re-plan: get_slots is read-only and
# runs before the call, while hold (write) and confirm (irreversible) must not
# be reachable until the owner has actually agreed. UEBA rule G3 enforces that.
BOOKING_PLAN_ADDITIONS = ["scheduler.hold", "scheduler.confirm"]

# Post-service follow-up is its own run, not a tail node on the booking run:
# the workshop closes the job days after the appointment is made, long after
# the booking run has ended. It therefore declares its own plan — which is what
# authorizes maintenance.append_record (irreversible) under UEBA rule G3.
FEEDBACK_PLAN = [
    "runs.write_plan", "runs.close", "crm.get_customer",
    "voice.speak", "voice.listen", "survey.record", "maintenance.append_record",
]


async def _plan(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=MASTER_ID, vin=state.get("vin"))
    rationale, _ = await complete(
        f"State the one-line plan for run {state['run_id']} on vin {state['vin']}, "
        f"trigger={state['trigger']}.",
        fixture_key="master.plan_rationale", fixture_vars={"vin": state["vin"]},
    )
    await invoke(MASTER_ID, "runs.write_plan", {"steps": INITIAL_PLAN, "rationale": rationale}, ctx)
    return {**state, "plan": INITIAL_PLAN, "completed": []}


async def _replan_for_booking(state: FleetState) -> FleetState:
    """Owner said yes — extend the declared plan so scheduler.confirm (an
    irreversible tool) is authorized, and emit that as a visible re-plan."""
    ctx = ToolContext(run_id=state["run_id"], agent_id=MASTER_ID, vin=state.get("vin"))
    new_plan = [*state["plan"], *BOOKING_PLAN_ADDITIONS]
    rationale, _ = await complete(
        f"Owner accepted for {state['vin']} — extend the plan to allow booking.",
        fixture_key="master.replan_booking", fixture_vars={"vin": state["vin"]},
    )
    await invoke(MASTER_ID, "runs.write_plan", {"steps": new_plan, "rationale": rationale}, ctx)
    return {**state, "plan": new_plan}


async def _plan_feedback(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=MASTER_ID, vin=state.get("vin"))
    rationale, _ = await complete(
        f"Service completed for {state['vin']} — plan the post-service follow-up.",
        fixture_key="master.plan_feedback", fixture_vars={"vin": state["vin"]},
    )
    await invoke(MASTER_ID, "runs.write_plan", {"steps": FEEDBACK_PLAN, "rationale": rationale}, ctx)
    return {**state, "plan": FEEDBACK_PLAN, "completed": []}


async def _close(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=MASTER_ID, vin=state.get("vin"))
    if state.get("halted"):
        outcome = "halted"
    elif state.get("feedback"):
        outcome = "feedback_captured"
    elif state.get("service_status") == "booked":
        outcome = "booked"
    elif "customer_engagement" in state.get("completed", []) and not state.get("intent_to_book"):
        outcome = "declined"
    else:
        outcome = "completed"
    summary = state.get("halt_reason") or (
        f"health={((state.get('health') or {}).get('health_class'))} "
        f"top_risk={((state.get('diagnosis') or {}).get('top') or {}).get('component')} "
        f"outcome={outcome}"
    )
    await invoke(MASTER_ID, "runs.close", {"outcome": outcome, "summary": summary}, ctx)
    return {**state, "service_status": outcome}


def _after_data_analysis(state: FleetState) -> str:
    return "close" if state.get("halted") else "diagnosis_step"


def _after_diagnosis(state: FleetState) -> str:
    if state.get("halted"):
        return "close"
    top = (state.get("diagnosis") or {}).get("top")
    return "propose_slots" if top and top.get("severity") else "close"


def _after_engagement(state: FleetState) -> str:
    if state.get("halted"):
        return "close"
    return "replan_for_booking" if state.get("intent_to_book") else "close"


def build_graph():
    graph = StateGraph(FleetState)
    # Node names must not collide with FleetState keys (LangGraph forbids it) —
    # "plan_step"/"diagnosis_step" not "plan"/"diagnosis", since both are
    # state fields (`plan: list[str]`, `diagnosis: dict | None`).
    graph.add_node("plan_step", _plan)
    graph.add_node("data_analysis", data_analysis.run)
    graph.add_node("diagnosis_step", diagnosis.run)
    graph.add_node("propose_slots", scheduling.propose)
    graph.add_node("customer_engagement", customer_engagement.run)
    graph.add_node("replan_for_booking", _replan_for_booking)
    graph.add_node("scheduling", scheduling.run)
    graph.add_node("send_confirmation", customer_engagement.send_confirmation)
    graph.add_node("close", _close)

    graph.set_entry_point("plan_step")
    graph.add_edge("plan_step", "data_analysis")
    graph.add_conditional_edges("data_analysis", _after_data_analysis, {
        "diagnosis_step": "diagnosis_step", "close": "close",
    })
    graph.add_conditional_edges("diagnosis_step", _after_diagnosis, {
        "propose_slots": "propose_slots", "close": "close",
    })
    graph.add_edge("propose_slots", "customer_engagement")
    graph.add_conditional_edges("customer_engagement", _after_engagement, {
        "replan_for_booking": "replan_for_booking", "close": "close",
    })
    graph.add_edge("replan_for_booking", "scheduling")
    graph.add_edge("scheduling", "send_confirmation")
    graph.add_edge("send_confirmation", "close")
    graph.add_edge("close", END)
    return graph.compile()


def build_feedback_graph():
    """plan -> feedback -> close. Separate from the booking graph because it is
    triggered by the workshop closing the job, not by the telemetry alert."""
    graph = StateGraph(FleetState)
    graph.add_node("plan_step", _plan_feedback)
    graph.add_node("feedback_step", feedback.run)
    graph.add_node("close", _close)
    graph.set_entry_point("plan_step")
    graph.add_edge("plan_step", "feedback_step")
    graph.add_edge("feedback_step", "close")
    graph.add_edge("close", END)
    return graph.compile()


_compiled = None
_compiled_feedback = None


def get_graph():
    global _compiled
    if _compiled is None:
        _compiled = build_graph()
    return _compiled


def get_feedback_graph():
    global _compiled_feedback
    if _compiled_feedback is None:
        _compiled_feedback = build_feedback_graph()
    return _compiled_feedback


async def run_fleet_graph(vin: str, trigger: str = "manual") -> FleetState:
    initial: FleetState = {
        "run_id": f"run-{uuid.uuid4().hex[:8]}",
        "vin": vin,
        "trigger": trigger,  # type: ignore[typeddict-item]
        "plan": [],
        "completed": [],
        "halted": False,
        "halt_reason": None,
    }
    return await get_graph().ainvoke(initial)


async def run_feedback_graph(vin: str, booking: dict, diagnosis: dict | None = None) -> FleetState:
    """Follow up after the workshop closes the job. `booking` is the dict
    returned by the booking run (needs `appointment_id`)."""
    initial: FleetState = {
        "run_id": f"fb-{uuid.uuid4().hex[:8]}",
        "vin": vin,
        "trigger": "manual",  # type: ignore[typeddict-item]
        "booking": booking,
        "diagnosis": diagnosis or {},
        "service_status": "completed",
        "plan": [], "completed": [], "halted": False, "halt_reason": None,
    }
    return await get_feedback_graph().ainvoke(initial)
