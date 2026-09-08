"""
Chat conversation persistence.

Split out of api_chat.py so the endpoint keeps reading as agent orchestration
rather than as SQL. Everything here is synchronous and called through
`asyncio.to_thread` — the same pattern the rest of app/db uses.

A conversation is resumed, not restarted, whenever an open one exists for
(vin, principal). That is the whole point: reopening the assistant about a
problem you already discussed should continue the discussion, and the agent
should be able to see what it already said — otherwise "how much did you say
it was?" has no referent.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select

from app.db.models import ChatMessage, ChatSession
from app.db.session import SessionLocal

# How many prior turns are replayed into an LLM prompt. Enough for a follow-up
# to resolve ("that price", "the Saturday one") without paying to re-send an
# entire conversation on every turn.
HISTORY_TURNS = 8


def _msg_dict(m: ChatMessage) -> dict:
    """Shaped exactly like a live turn so the frontend needs no second path."""
    out: dict = {"role": m.role, "text": m.text}
    for key, value in (("agent", m.agent_id), ("strategy", m.strategy),
                       ("source", m.source), ("intent", m.intent),
                       ("intentSource", m.intent_source),
                       ("grounded_in", m.grounded_in)):
        if value is not None:
            out[key] = value
    return out


def open_session(vin: str, principal_id: str) -> dict | None:
    """The caller's resumable conversation for this vehicle, if any."""
    with SessionLocal() as s:
        row = s.execute(
            select(ChatSession)
            .where(ChatSession.vin == vin,
                   ChatSession.principal_id == principal_id,
                   ChatSession.status == "open")
            .order_by(ChatSession.updated_at.desc())
            .limit(1)
        ).scalar_one_or_none()
        if not row:
            return None
        messages = s.execute(
            select(ChatMessage).where(ChatMessage.run_id == row.run_id)
            .order_by(ChatMessage.id.asc())
        ).scalars().all()
        return {
            "run_id": row.run_id,
            "plan": row.plan or [],
            "offered_slots": row.offered_slots or [],
            "objections_handled": row.objections_handled or 0,
            "booking": row.booking,
            "turns": [_msg_dict(m) for m in messages],
        }


def create_session(run_id: str, vin: str, principal_id: str, plan: list,
                   offered_slots: list) -> None:
    now = dt.datetime.utcnow()
    with SessionLocal() as s:
        s.add(ChatSession(run_id=run_id, vin=vin, principal_id=principal_id,
                          status="open", plan=plan, offered_slots=offered_slots,
                          objections_handled=0, created_at=now, updated_at=now))
        s.commit()


def append_turns(run_id: str, turns: list[dict]) -> None:
    """Persist turns in the order given — `id` ordering is what replays them."""
    if not turns:
        return
    with SessionLocal() as s:
        for t in turns:
            s.add(ChatMessage(
                run_id=run_id, role=t.get("role", "agent"), text=t.get("text", ""),
                agent_id=t.get("agent"), strategy=t.get("strategy"),
                source=t.get("source"), intent=t.get("intent"),
                intent_source=t.get("intent_source"),
                grounded_in=t.get("grounded_in"),
            ))
        s.commit()


def update_session(run_id: str, *, plan: list | None = None,
                   offered_slots: list | None = None,
                   objections_handled: int | None = None,
                   booking: dict | None = None,
                   status: str | None = None) -> None:
    with SessionLocal() as s:
        row = s.get(ChatSession, run_id)
        if not row:
            return
        if plan is not None:
            row.plan = plan
        if offered_slots is not None:
            row.offered_slots = offered_slots
        if objections_handled is not None:
            row.objections_handled = objections_handled
        if booking is not None:
            row.booking = booking
        if status is not None:
            row.status = status
        row.updated_at = dt.datetime.utcnow()
        s.commit()


def close_open_sessions(vin: str, principal_id: str) -> int:
    """End whatever is open so the next /start begins a fresh thread.

    Closed rather than deleted: the transcript is a record of what an
    automated system said to a customer about their brakes, which is exactly
    the kind of thing that should still exist when someone asks later.
    """
    with SessionLocal() as s:
        rows = s.execute(
            select(ChatSession).where(ChatSession.vin == vin,
                                      ChatSession.principal_id == principal_id,
                                      ChatSession.status == "open")
        ).scalars().all()
        for row in rows:
            row.status = "closed"
            row.updated_at = dt.datetime.utcnow()
        s.commit()
        return len(rows)


def recent_history(run_id: str, limit: int = HISTORY_TURNS) -> list[dict]:
    """The last few turns, oldest-first, for prompting.

    Selected newest-first then reversed, so a long conversation contributes its
    most recent turns rather than its opening ones — the far end is what a
    follow-up question actually refers back to.
    """
    with SessionLocal() as s:
        rows = s.execute(
            select(ChatMessage).where(ChatMessage.run_id == run_id)
            .order_by(ChatMessage.id.desc()).limit(limit)
        ).scalars().all()
    return [{"role": m.role, "text": m.text} for m in reversed(rows)]
