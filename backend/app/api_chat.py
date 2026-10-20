"""
Live customer chat — the same Customer Engagement / Scheduling Agent logic
that a full Master-graph run uses (config/strategies.yaml's named strategies,
the real objection classifier, the real slot ranking and booking path),
exposed turn-by-turn over HTTP instead of run once, start-to-finish, with a
pre-scripted reply.

`voice.listen`'s `utterance` field already exists specifically for "a real
mic round-trip is a drop-in replacement behind the same tool contract" (see
that tool's docstring) — this endpoint is that drop-in: the owner's typed
message *is* the utterance, no fixture script involved.

Deliberately stateless server-side: the caller carries `run_id`, `plan`,
`offered_slots` and `objections_handled` back on every /reply call rather
than this module keeping a session dict, so a page reload never orphans a
conversation the client has already forgotten about.

One adaptation from the batch node: MAX_OBJECTION_ROUNDS=2 in
customer_engagement.py exists so a *scripted* demo run terminates
deterministically. A live chat has no such need — a real owner can keep
talking — so this endpoint does not cap objection rounds; classify_objection()
just keeps answering, falling back to LOW_FRICTION indefinitely like the
config file's own `default_objection_counter` already implies it should.

Every owner message is routed by intent (llm/intent.py) rather than assumed to
be an objection. QUESTION is the interesting one, and it is answered by a real
two-agent hop rather than by widening one agent's reach: agent_policy.yaml
denies `telemetry.*` and `ml.*` to customer_engagement_agent — "gets its facts
from the Diagnosis output" — so the facts are gathered under diagnosis_agent's
entitlements and only the finished fact list crosses to the agent that speaks.
Granting the talking agent telemetry access would have been three fewer lines
and would have quietly deleted the boundary the Security Console demonstrates.
"""

from __future__ import annotations

import asyncio
import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text

from app.auth.deps import requires
from app.auth.principal import Principal
from app.auth.scope import can_access_vin
from app.db import chat as chat_db
from app.db.session import engine
from app.graph.master import BOOKING_PLAN_ADDITIONS, INITIAL_PLAN
from app.graph.nodes.customer_engagement import ACCEPT_PHRASES, _slot_phrasing
from app.graph.nodes.scheduling import WEEKEND, rank_slots
from app.llm.answering import build_answer_facts
from app.llm.fixtures import classify_objection
from app.llm.intent import classify_intent
from app.llm.persuasion import has_daily_earning, latest_reading
from app.tools.registry import ToolBlocked, ToolContext, invoke

router = APIRouter(prefix="/api/chat", tags=["chat"])

MASTER_ID = "master_agent"
ENGAGEMENT_ID = "customer_engagement_agent"
SCHEDULING_ID = "scheduling_agent"
DIAGNOSIS_ID = "diagnosis_agent"
OPENING_STRATEGIES = ["PERSONALISE", "EVIDENCE", "CONSEQUENCE", "CONTRAST", "LOSS_FRAME"]

# How far back to look for the readings and fault codes quoted in an answer.
# Matches the window the Diagnosis Agent uses in its own batch node, so the
# chat quotes the same evidence a full run would.
ANSWER_WINDOW_MINUTES = 1440


def _sounds_like_accept(text_: str) -> bool:
    t = (text_ or "").lower()
    return any(p in t for p in ACCEPT_PHRASES)


def _top_prediction(vin: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT component, severity, failure_prob, days_to_failure "
                 "FROM predictions WHERE vin = :v AND severity IS NOT NULL "
                 "ORDER BY failure_prob DESC LIMIT 1"),
            {"v": vin},
        ).first()
    return dict(row._mapping) if row else None


async def _telemetry_reading(vin: str, component: str, diag_ctx: ToolContext) -> str | None:
    """The sensor value the EVIDENCE line quotes, read under diagnosis_agent.

    Goes through the tool registry rather than straight to db.queries so this
    read lands in the audit trail and is subject to the same policy as every
    other telemetry access. Reading it directly would have worked and left no
    trace — which is exactly the shape of the gap UEBA exists to close, and a
    hole in the demo's own claim that the registry is the only way in.
    """
    res = await invoke(DIAGNOSIS_ID, "telemetry.read_window",
                       {"vin": vin, "minutes": 240}, diag_ctx)
    return latest_reading((res.data or {}).get("rows", []), component)


async def _fetch_customer(agent_id: str, ctx: ToolContext) -> dict:
    res = await invoke(agent_id, "crm.get_customer", {"vin": ctx.vin}, ctx)
    return res.data or {}


async def _fetch_slots(customer: dict, ctx: ToolContext) -> list[dict]:
    res = await invoke(SCHEDULING_ID, "scheduler.get_slots", {
        "center_id": customer.get("pref_center_id"), "days": 14,
    }, ctx)
    slots = (res.data or {}).get("slots", [])
    if not slots:
        res = await invoke(SCHEDULING_ID, "scheduler.get_slots", {"days": 14}, ctx)
        slots = (res.data or {}).get("slots", [])
    return rank_slots(slots, customer)


async def _gather_facts(vin: str, top: dict | None, customer: dict,
                        offered_slots: list[dict], diag_ctx: ToolContext) -> list[str]:
    """Collect what an answer may be grounded in, under diagnosis_agent.

    Every failure here is swallowed to a partial fact list rather than raised:
    a missing service history should cost the owner that one line, not the
    whole answer. `build_answer_facts` omits absent values entirely, and the
    answering prompt's refusal instruction covers what is left out.
    """
    from app.db.queries import vehicle_info
    from app.llm.persuasion import _component_economics

    facts_kwargs: dict = {
        "vehicle": await asyncio.to_thread(vehicle_info, vin),
        "customer": customer,
        "prediction": top,
        "offered_slots": offered_slots,
    }

    if top and top.get("component"):
        facts_kwargs["economics"] = _component_economics().get(top["component"])

    try:
        tel = await invoke(DIAGNOSIS_ID, "telemetry.read_window",
                           {"vin": vin, "minutes": ANSWER_WINDOW_MINUTES}, diag_ctx)
        rows = (tel.data or {}).get("rows", [])
        if top and top.get("component"):
            facts_kwargs["reading"] = latest_reading(rows, top["component"])

        # Fault codes come off the newest row that actually carries any — the
        # very last row is often clean even while a code is intermittently set,
        # and reporting "no active faults" on that basis would be wrong.
        codes: list[str] = []
        for row in reversed(rows):
            if row.get("dtc_codes"):
                codes = list(row["dtc_codes"])
                break
        dtcs = []
        for code in codes[:3]:
            looked = await invoke(DIAGNOSIS_ID, "dtc.lookup", {"code": code}, diag_ctx)
            if looked.ok and looked.data and not looked.data.get("error"):
                dtcs.append(looked.data)
        facts_kwargs["dtcs"] = dtcs
    except ToolBlocked:
        raise
    except Exception:  # noqa: BLE001 — a partial answer beats a failed turn
        pass

    try:
        hist = await invoke(DIAGNOSIS_ID, "maintenance.read_history",
                            {"vin": vin, "limit": 5}, diag_ctx)
        facts_kwargs["history"] = (hist.data or {}).get("records", [])
    except ToolBlocked:
        raise
    except Exception:  # noqa: BLE001
        pass

    # Travel time to the offered centre. Under the SCHEDULING agent, which is
    # the one entitled to maps.* — the diagnosis agent is denied scheduler and
    # maps tools, and the engagement agent that speaks the answer holds neither.
    slot = (offered_slots or [None])[0]
    city = (facts_kwargs.get("vehicle") or {}).get("city")
    if slot and city:
        try:
            sched_ctx = ToolContext(run_id=diag_ctx.run_id, agent_id=SCHEDULING_ID, vin=vin)
            trip = await invoke(SCHEDULING_ID, "maps.eta",
                                {"from_city": city, "center_id": slot.get("center_id")},
                                sched_ctx)
            if trip.ok and (trip.data or {}).get("minutes") is not None:
                facts_kwargs["travel"] = trip.data
        except ToolBlocked:
            raise
        except Exception:  # noqa: BLE001
            pass

    return build_answer_facts(**facts_kwargs)


async def _persist(req, intent: str, intent_source: str, turns: list[dict],
                   *, offered_slots: list[dict] | None = None,
                   plan: list | None = None, objections_handled: int | None = None,
                   booking: dict | None = None, done: bool = False) -> None:
    """Write the owner's message and the agent's turns, then the session state.

    The owner's message is stored here rather than at the top of the handler so
    that a turn UEBA refuses (a rejected injection raises before reaching this
    point) leaves no trace in the customer-visible transcript — it belongs in
    the security audit log, which already has it, not in the conversation the
    owner reopens tomorrow.
    """
    await asyncio.to_thread(chat_db.append_turns, req.run_id, [
        {"role": "user", "text": req.message,
         "intent": intent, "intent_source": intent_source},
        *turns,
    ])
    await asyncio.to_thread(
        chat_db.update_session, req.run_id,
        plan=plan, offered_slots=offered_slots,
        objections_handled=objections_handled, booking=booking,
        status="closed" if done else None,
    )


class ChatStartRequest(BaseModel):
    vin: str
    # Set by the "Start over" control. Without it /start always resumes, which
    # is the right default but leaves no way back to a clean thread.
    restart: bool = False


class ChatReplyRequest(BaseModel):
    vin: str
    run_id: str
    plan: list[str]
    message: str
    offered_slots: list[dict] = []
    objections_handled: int = 0


@router.post("/start")
async def chat_start(req: ChatStartRequest, principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    if not await asyncio.to_thread(can_access_vin, principal, req.vin):
        raise HTTPException(404, f"unknown vin {req.vin}")

    if req.restart:
        await asyncio.to_thread(chat_db.close_open_sessions, req.vin, principal.user_id)
    else:
        # Resume before doing anything else — no tool calls, no LLM spend, and
        # crucially no second set of opening pitches appended to a conversation
        # the owner already read.
        existing = await asyncio.to_thread(chat_db.open_session, req.vin, principal.user_id)
        if existing and existing["turns"]:
            return {**existing, "intent_to_book": False,
                    "done": bool(existing.get("booking")), "resumed": True}

    top = _top_prediction(req.vin)
    if not top:
        return {"run_id": None, "turns": [], "offered_slots": [], "plan": [],
                "objections_handled": 0, "intent_to_book": False, "booking": None,
                "done": True, "note": "Nothing to discuss right now — your vehicle has no active predicted issue."}

    run_id = f"chat-{uuid.uuid4().hex[:8]}"
    master_ctx = ToolContext(run_id=run_id, agent_id=MASTER_ID, vin=req.vin)
    agent_ctx = ToolContext(run_id=run_id, agent_id=ENGAGEMENT_ID, vin=req.vin)
    sched_ctx = ToolContext(run_id=run_id, agent_id=SCHEDULING_ID, vin=req.vin)
    diag_ctx = ToolContext(run_id=run_id, agent_id=DIAGNOSIS_ID, vin=req.vin)

    diagnosis = {"top": top}
    turns: list[dict] = []

    try:
        await invoke(MASTER_ID, "runs.write_plan",
                     {"steps": INITIAL_PLAN, "rationale": f"Owner opened chat about {top['component']}."},
                     master_ctx)

        customer = await _fetch_customer(ENGAGEMENT_ID, agent_ctx)
        # Only offered_slots[0] is ever spoken or booked — the rest of a
        # 14-day window is dead weight over the wire, so trim what leaves
        # this endpoint (ranking already happened over the full set).
        offered_slots = (await _fetch_slots(customer, sched_ctx))[:3]
        slot_words = _slot_phrasing(offered_slots)
        reading = await _telemetry_reading(req.vin, top["component"], diag_ctx)

        strategies = [s for s in OPENING_STRATEGIES
                      if s != "LOSS_FRAME" or has_daily_earning(req.vin)]
        for strategy in strategies:
            r = await invoke(ENGAGEMENT_ID, "llm.persuade", {
                "strategy": strategy, "diagnosis": diagnosis, "reading": reading, **slot_words,
            }, agent_ctx)
            if r.ok and r.data and r.data.get("text"):
                turns.append({"role": "agent", "strategy": strategy, "agent": ENGAGEMENT_ID,
                              "text": r.data["text"], "source": r.data.get("source")})
    except ToolBlocked as e:
        raise HTTPException(403, f"UEBA blocked this conversation: {e}")

    await asyncio.to_thread(chat_db.create_session, run_id, req.vin,
                            principal.user_id, INITIAL_PLAN, offered_slots)
    await asyncio.to_thread(chat_db.append_turns, run_id, turns)

    return {
        "run_id": run_id, "plan": INITIAL_PLAN, "turns": turns,
        "offered_slots": offered_slots, "objections_handled": 0,
        "intent_to_book": False, "booking": None, "done": False, "resumed": False,
    }


@router.post("/reply")
async def chat_reply(req: ChatReplyRequest, principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    if not await asyncio.to_thread(can_access_vin, principal, req.vin):
        raise HTTPException(404, f"unknown vin {req.vin}")

    top = _top_prediction(req.vin)
    if not top:
        raise HTTPException(404, "no active prediction for this vehicle")
    diagnosis = {"top": top}

    master_ctx = ToolContext(run_id=req.run_id, agent_id=MASTER_ID, vin=req.vin)
    agent_ctx = ToolContext(run_id=req.run_id, agent_id=ENGAGEMENT_ID, vin=req.vin)
    sched_ctx = ToolContext(run_id=req.run_id, agent_id=SCHEDULING_ID, vin=req.vin)
    diag_ctx = ToolContext(run_id=req.run_id, agent_id=DIAGNOSIS_ID, vin=req.vin)

    try:
        # Real tool call even though the transcript is already known — keeps
        # this turn in the audit trail the same way a live mic round-trip
        # would be, instead of a side-channel the guard never sees. It is also
        # where UEBA Layer C scans the message for prompt injection, so it must
        # stay the FIRST thing that touches an owner's words.
        await invoke(ENGAGEMENT_ID, "voice.listen", {"utterance": req.message}, agent_ctx)

        # Read history BEFORE the incoming message is stored, so the prompt sees
        # "what was said up to now" and not the question duplicated as its own
        # context.
        history = await asyncio.to_thread(chat_db.recent_history, req.run_id)
        intent, intent_source = await classify_intent(req.message, history)

        # The classifier is advisory for booking, never authoritative: an
        # explicit "book it" books even if the model called it a question.
        if intent != "ACCEPT" and _sounds_like_accept(req.message):
            intent = "ACCEPT"

        if intent == "QUESTION":
            customer = await _fetch_customer(ENGAGEMENT_ID, agent_ctx)
            facts = await _gather_facts(req.vin, top, customer, req.offered_slots, diag_ctx)
            r = await invoke(ENGAGEMENT_ID, "llm.answer",
                             {"utterance": req.message, "facts": facts,
                              "history": history}, agent_ctx)
            turns = []
            if r.ok and r.data and r.data.get("text"):
                turns.append({"role": "agent", "strategy": "ANSWER", "agent": ENGAGEMENT_ID,
                              "text": r.data["text"], "source": r.data.get("source"),
                              "grounded_in": len(facts)})
            await _persist(req, intent, intent_source, turns)
            return {
                "run_id": req.run_id, "plan": req.plan, "turns": turns,
                "offered_slots": req.offered_slots,
                "objections_handled": req.objections_handled,
                "intent": intent, "intent_source": intent_source,
                "intent_to_book": False, "booking": None, "done": False,
            }

        if intent == "DECLINE":
            # No counter-strategy, by design. Continuing to persuade past an
            # explicit refusal is the behaviour that gets a service line
            # blocked, and no config value should be able to switch it back on.
            turns = [{"role": "agent", "strategy": "CLOSE_POLITE", "agent": ENGAGEMENT_ID,
                      "text": ("Understood — I won't push. The alert stays on your "
                               "vehicle, so whenever you want to book, it's one tap away. "
                               "Please drive carefully."),
                      "source": "policy"}]
            await _persist(req, intent, intent_source, turns, done=True)
            return {
                "run_id": req.run_id, "plan": req.plan, "turns": turns,
                "offered_slots": req.offered_slots,
                "objections_handled": req.objections_handled,
                "intent": intent, "intent_source": intent_source,
                "intent_to_book": False, "booking": None, "done": True,
            }

        if intent == "ACCEPT":
            new_plan = [*req.plan, *BOOKING_PLAN_ADDITIONS]
            await invoke(MASTER_ID, "runs.write_plan",
                         {"steps": new_plan, "rationale": f"Owner accepted for {req.vin} — extend the plan to allow booking."},
                         master_ctx)

            if not req.offered_slots:
                turns = [{"role": "agent", "strategy": None, "agent": SCHEDULING_ID,
                          "text": "I don't have an open slot to offer right now — let me have someone from the centre call you."}]
                no_capacity = {"booked": False, "reason": "no capacity"}
                await _persist(req, intent, intent_source, turns, plan=new_plan,
                               offered_slots=[], booking=no_capacity, done=True)
                return {"run_id": req.run_id, "plan": new_plan, "turns": turns,
                        "offered_slots": [], "objections_handled": req.objections_handled,
                        "intent": intent, "intent_source": intent_source,
                        "intent_to_book": True, "booking": no_capacity, "done": True}

            best = req.offered_slots[0]
            customer = await _fetch_customer(ENGAGEMENT_ID, agent_ctx)
            held = await invoke(SCHEDULING_ID, "scheduler.hold", {
                "center_id": best["center_id"], "slot_start": best["slot_start"], "vin": req.vin,
            }, sched_ctx)
            booking = None
            existing = (held.data or {}).get("existing")
            if (held.data or {}).get("held"):
                confirmed = await invoke(SCHEDULING_ID, "scheduler.confirm", {
                    "center_id": best["center_id"], "slot_start": best["slot_start"],
                    "vin": req.vin, "customer_id": customer.get("customer_id"),
                }, sched_ctx)
                booking = confirmed.data
            elif existing:
                booking = {"booked": True, "already_booked": True, **existing}

            turns = []
            if existing:
                words = _slot_phrasing([existing])
                turns.append({"role": "agent", "strategy": None, "agent": SCHEDULING_ID,
                              "text": f"You're already booked at {words['center_name']} on "
                                      f"{words['slot_day']} at {words['slot_time']} — "
                                      "I've kept that booking rather than make a second one."})
            elif booking and booking.get("booked"):
                slot_words = _slot_phrasing([best])
                r = await invoke(ENGAGEMENT_ID, "llm.persuade", {
                    "strategy": "CLOSE_CONFIRM", "diagnosis": diagnosis, **slot_words,
                }, agent_ctx)
                if r.ok and r.data and r.data.get("text"):
                    turns.append({"role": "agent", "strategy": "CLOSE_CONFIRM", "agent": ENGAGEMENT_ID,
                                  "text": r.data["text"], "source": r.data.get("source")})
                await invoke(ENGAGEMENT_ID, "notify.push", {
                    "customer_id": customer.get("customer_id"),
                    "title": "Appointment confirmed",
                    "body": f"{booking.get('center_id')} — {booking.get('slot_start')}",
                }, agent_ctx)
            else:
                turns.append({"role": "agent", "strategy": None, "agent": SCHEDULING_ID,
                              "text": "That slot just got taken — let me have the centre call you to find another."})

            await _persist(req, intent, intent_source, turns, plan=new_plan,
                           booking=booking, done=True)
            return {"run_id": req.run_id, "plan": new_plan, "turns": turns,
                    "offered_slots": req.offered_slots, "objections_handled": req.objections_handled,
                    "intent": intent, "intent_source": intent_source,
                    "intent_to_book": True, "booking": booking, "done": True}

        # Objection path — real keyword classification, not a canned reply.
        counter, constraint = classify_objection(req.message)
        offered_slots = req.offered_slots
        if constraint == "weekend_only":
            # Re-rank against the full capacity window, not just the 3 slots
            # already shown — those 3 were picked before this constraint was
            # known and may not contain a single weekend slot to re-rank.
            customer = await _fetch_customer(ENGAGEMENT_ID, agent_ctx)
            offered_slots = (await _fetch_slots(customer, sched_ctx))
            offered_slots = rank_slots(offered_slots, customer, WEEKEND)[:3]
        slot_words = _slot_phrasing(offered_slots)
        reading = await _telemetry_reading(req.vin, top["component"], diag_ctx)

        r = await invoke(ENGAGEMENT_ID, "llm.persuade", {
            "strategy": counter, "diagnosis": diagnosis, "utterance": req.message,
            "reading": reading, **slot_words,
        }, agent_ctx)
        turns = [{"role": "agent", "strategy": counter, "agent": ENGAGEMENT_ID,
                  "text": r.data["text"], "source": r.data.get("source")}] \
            if r.ok and r.data and r.data.get("text") else []
    except ToolBlocked as e:
        raise HTTPException(403, f"UEBA blocked this conversation: {e}")

    objections = req.objections_handled + 1
    await _persist(req, intent, intent_source, turns,
                   offered_slots=offered_slots, objections_handled=objections)

    return {
        "run_id": req.run_id, "plan": req.plan, "turns": turns,
        "offered_slots": offered_slots, "objections_handled": objections,
        "intent": intent, "intent_source": intent_source,
        "intent_to_book": False, "booking": None, "done": False,
    }
