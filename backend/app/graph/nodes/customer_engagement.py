"""
Customer Engagement Agent — runs the persuasion policy in config/strategies.yaml
(PROJECT_PLAN §5.4) against the top diagnosis finding, and updates
`intent_to_book` on FleetState. Objection handling is a bounded loop *inside*
this node (max 2 rounds) — the Master-level re-plan this feeds is the
scheduling strategy switch in nodes/scheduling.py when intent_to_book is
False (see build_graph()'s conditional edges in master.py).

Voice is text-only for now (no TTS/STT wired yet — Week 2). voice.listen()
takes an injected `utterance` for DEMO_MODE / red-team / smoke-test use; a
live mic round-trip is a drop-in replacement behind the same tool contract.
"""

from __future__ import annotations

import datetime as dt

from app.graph.state import FleetState
from app.llm.fixtures import classify_objection
from app.graph.nodes.scheduling import WEEKEND, rank_slots
from app.llm.persuasion import has_daily_earning, latest_reading
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "customer_engagement_agent"

ACCEPT_PHRASES = ["haan", "book kar do", "yes", "book it", "go ahead", "ok book", "sure"]
OPENING_STRATEGIES = ["PERSONALISE", "EVIDENCE", "CONSEQUENCE", "CONTRAST", "LOSS_FRAME"]
MAX_OBJECTION_ROUNDS = 2


def _slot_phrasing(offered_slots: list[dict]) -> dict:
    """Turn the top ranked slot into the words LOW_FRICTION / CLOSE_CONFIRM
    speak. Empty when no capacity was found, so the templates fall back to
    their generic wording instead of promising a slot that doesn't exist."""
    if not offered_slots:
        return {}
    slot = offered_slots[0]
    start = dt.datetime.fromisoformat(slot["slot_start"])
    return {
        "slot_day": start.strftime("%A"),
        # "%-I" is glibc-only; lstrip keeps this working on Windows too.
        "slot_time": start.strftime("%I %p").lstrip("0"),
        "center_name": slot.get("center_name", ""),
    }


def _sounds_like_accept(utterance: str) -> bool:
    text = (utterance or "").lower()
    return any(p in text for p in ACCEPT_PHRASES)


class TurnFailed(RuntimeError):
    """A persuasion turn produced no text — surfaced as a halt rather than
    letting the call continue with a silent gap in the transcript."""


def _turn_text(result) -> str:
    if not result.ok or not result.data or not result.data.get("text"):
        raise TurnFailed(result.error or (result.data or {}).get("error") or "empty turn")
    return result.data["text"]


async def run(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])
    diagnosis = state.get("diagnosis") or {}
    top = diagnosis.get("top")
    conversation: list[dict] = []

    if not top or not top.get("severity"):
        return {**state, "conversation": conversation,
                "completed": [*state.get("completed", []), "customer_engagement"]}

    try:
        consent = await invoke(AGENT_ID, "crm.get_consent", {"vin": state["vin"]}, ctx)
        customer = await invoke(AGENT_ID, "crm.get_customer", {"vin": state["vin"]}, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    if not (consent.data or {}).get("voice"):
        try:
            await invoke(AGENT_ID, "notify.push", {
                "customer_id": (customer.data or {}).get("customer_id"),
                "title": "Service recommended",
                "body": f"Your {top['component'].replace('_', ' ')} needs attention soon.",
            }, ctx)
        except ToolBlocked as e:
            return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}
        return {**state, "conversation": conversation, "customer": customer.data or {},
                "completed": [*state.get("completed", []), "customer_engagement"]}

    intent_to_book = False
    objections_handled = 0
    listen_turn = 0

    reading = latest_reading(state.get("telemetry_window") or [], top["component"])
    offered_slots = state.get("offered_slots") or []
    slot_words = _slot_phrasing(offered_slots)
    # LOSS_FRAME quotes lost daily earnings — meaningless for a private owner
    # who never declared any, so drop it rather than speak an empty rupee figure.
    strategies = [s for s in OPENING_STRATEGIES
                  if s != "LOSS_FRAME" or has_daily_earning(state["vin"])]

    try:
        for strategy in strategies:
            turn_result = await invoke(AGENT_ID, "llm.persuade", {
                "strategy": strategy, "diagnosis": diagnosis, "reading": reading,
                **slot_words,
            }, ctx)
            conversation.append({"role": "agent", "strategy": strategy, "text": _turn_text(turn_result)})

        reply = await invoke(AGENT_ID, "voice.listen", {"turn": listen_turn}, ctx)
        utterance = (reply.data or {}).get("transcript", "")
        conversation.append({"role": "customer", "text": utterance})

        while not intent_to_book and objections_handled < MAX_OBJECTION_ROUNDS and utterance:
            if _sounds_like_accept(utterance):
                intent_to_book = True
                break
            counter, constraint = classify_objection(utterance)

            # An objection can reveal a scheduling constraint the profile never
            # captured ("I can't spare a weekday"). Re-rank what was already
            # offered rather than re-querying capacity — this agent is denied
            # scheduler.* by policy, and the slots are already in state.
            if constraint == "weekend_only":
                offered_slots = rank_slots(offered_slots, state.get("customer") or {}, WEEKEND)
                slot_words = _slot_phrasing(offered_slots)

            turn_result = await invoke(AGENT_ID, "llm.persuade", {
                "strategy": counter, "diagnosis": diagnosis,
                "utterance": utterance, "reading": reading, **slot_words,
            }, ctx)
            conversation.append({"role": "agent", "strategy": counter, "text": _turn_text(turn_result)})
            objections_handled += 1
            listen_turn += 1

            reply = await invoke(AGENT_ID, "voice.listen", {"turn": listen_turn}, ctx)
            utterance = (reply.data or {}).get("transcript", "")
            conversation.append({"role": "customer", "text": utterance})
            if _sounds_like_accept(utterance):
                intent_to_book = True
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}
    except TurnFailed as e:
        return {**state, "conversation": conversation, "halted": True,
                "halt_reason": f"{AGENT_ID} could not generate a turn: {e}"}

    return {
        **state,
        "conversation": conversation,
        "customer": customer.data or {},
        # Re-ranked if an objection revealed a constraint — the Scheduling Agent
        # books offered_slots[0], so this is what makes the counter-offer real
        # rather than just something the agent said.
        "offered_slots": offered_slots,
        "intent_to_book": intent_to_book,
        "objections_handled": objections_handled,
        "completed": [*state.get("completed", []), "customer_engagement"],
    }


async def send_confirmation(state: FleetState) -> FleetState:
    """Post-booking confirmation push.

    Runs as this agent, not the Master or the Scheduling Agent: notify.push is
    a `pii`-sensitivity tool and config/agent_policy.yaml's clearance ceiling
    caps master_agent at `internal`, while scheduling_agent's allowlist
    deliberately excludes the customer channel. The agent that talks to the
    owner is the one that confirms to them.
    """
    booking = state.get("booking") or {}
    if not booking.get("booked"):
        return state

    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])
    try:
        await invoke(AGENT_ID, "notify.push", {
            "customer_id": (state.get("customer") or {}).get("customer_id"),
            "title": "Appointment confirmed",
            "body": f"{booking.get('center_id')} — {booking.get('slot_start')}",
        }, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}
    return {**state, "completed": [*state.get("completed", []), "confirmation_sent"]}
