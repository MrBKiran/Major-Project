"""
Scheduling Agent — proposes a slot from real capacity_slots, holds it, and
confirms. Only reached when Customer Engagement set `intent_to_book=True`
(see master.py's conditional edges).

Slot ranking: customer's preferred centre first, then a slot inside their
preferred time window if they have one, else soonest available. This is
"LLM decides: slot ranking rationale" per §5.2 done as an explainable rule
rather than a model — the rationale IS the code, which is easier to defend
on stage than an opaque LLM ranking would be.

Auto-confirms immediately after holding rather than waiting for a second
customer round-trip (the demo script's separate "console wakes with ONE
confirmation card" step is a frontend/UX beat, not a backend agent decision —
Week 3 scope once the console exists).
"""

from __future__ import annotations

import datetime as dt

from app.graph.state import FleetState
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "scheduling_agent"
WEEKEND = ["saturday", "sunday"]


def _pref_hour_range(pref_time_window: list[str] | None) -> tuple[int, int] | None:
    if not pref_time_window or len(pref_time_window) != 2:
        return None
    try:
        lo = int(pref_time_window[0].split(":")[0])
        hi = int(pref_time_window[1].split(":")[0])
        return lo, hi
    except (ValueError, IndexError):
        return None


def rank_slots(slots: list[dict], customer: dict, day_names: list[str] | None = None) -> list[dict]:
    """Rank by preferred centre, then preferred day, then preferred hour window,
    then soonest. `day_names` overrides the customer's stored day preference —
    used when an objection ("I can't spare a weekday") reveals a constraint the
    profile didn't capture.
    """
    pref_center = customer.get("pref_center_id")
    hour_range = _pref_hour_range(customer.get("pref_time_window"))
    pref_days = {d.lower() for d in (day_names or customer.get("pref_day_preference") or [])}

    def score(slot: dict) -> tuple[int, int, int, str]:
        start = dt.datetime.fromisoformat(slot["slot_start"])
        centre_match = 0 if slot["center_id"] == pref_center else 1
        day_match = 0 if not pref_days or start.strftime("%A").lower() in pref_days else 1
        in_window = 0
        if hour_range:
            in_window = 0 if hour_range[0] <= start.hour <= hour_range[1] else 1
        # Day preference outranks centre: a customer who can only come Saturday
        # cannot use a weekday slot at their favourite centre.
        return (day_match, centre_match, in_window, slot["slot_start"])

    return sorted(slots, key=score)


async def propose(state: FleetState) -> FleetState:
    """Read-only slot lookup, run BEFORE the call so the Customer Engagement
    Agent has a concrete slot to offer ("Thursday 10 AM at Kothrud").

    It lives here rather than in the engagement node because
    config/agent_policy.yaml's allowlist model denies customer_engagement_agent
    every scheduler.* tool — the engagement agent reads the ranked result off
    FleetState instead of querying capacity itself.
    """
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])
    customer = state.get("customer") or {}

    try:
        if not customer:
            # Runs before the engagement node populates state["customer"], and
            # the preferred centre drives ranking — so fetch it here.
            cust_result = await invoke(AGENT_ID, "crm.get_customer", {"vin": state["vin"]}, ctx)
            customer = cust_result.data or {}

        slots_result = await invoke(AGENT_ID, "scheduler.get_slots", {
            "center_id": customer.get("pref_center_id"), "days": 14,
        }, ctx)
        slots = (slots_result.data or {}).get("slots", [])
        if not slots:
            # widen the search fleet-wide if the preferred centre is full
            slots_result = await invoke(AGENT_ID, "scheduler.get_slots", {"days": 14}, ctx)
            slots = (slots_result.data or {}).get("slots", [])
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "customer": customer,
        "offered_slots": rank_slots(slots, customer),
        "completed": [*state.get("completed", []), "propose_slots"],
    }


async def run(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])
    customer = state.get("customer") or {}
    slots = state.get("offered_slots") or []

    if not slots:
        return {**state, "booking": {"booked": False, "reason": "no capacity in the next 14 days"},
                "completed": [*state.get("completed", []), "scheduling"]}

    try:
        best = slots[0]
        held = await invoke(AGENT_ID, "scheduler.hold", {
            "center_id": best["center_id"], "slot_start": best["slot_start"], "vin": state["vin"],
        }, ctx)
        if not (held.data or {}).get("held"):
            return {**state, "booking": {"booked": False, "reason": (held.data or {}).get("error")},
                    "completed": [*state.get("completed", []), "scheduling"]}

        confirmed = await invoke(AGENT_ID, "scheduler.confirm", {
            "center_id": best["center_id"], "slot_start": best["slot_start"],
            "vin": state["vin"], "customer_id": customer.get("customer_id"),
        }, ctx)
        # Confirmation push is Customer Engagement's job, not Scheduling's —
        # config/agent_policy.yaml doesn't grant scheduling_agent notify.push,
        # deliberately: the agent that books shouldn't also be the one that
        # talks to the customer. The Master sends it from _close() instead.
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "booking": confirmed.data,
        "service_status": "booked" if (confirmed.data or {}).get("booked") else "hold_failed",
        "completed": [*state.get("completed", []), "scheduling"],
    }
