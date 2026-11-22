"""Persistence for the assistant: the thread, the long memory, proposed actions.

Synchronous, called through `asyncio.to_thread` like the rest of app/db.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import delete, select, update

from app.db.models import AssistantAction, AssistantMemory, AssistantMessage
from app.db.session import SessionLocal

# Turns replayed verbatim into the prompt; older ones live on as the summary.
RECENT_TURNS = 12
# Fold older turns into the summary once this many have piled up behind the recent ones.
SUMMARISE_AFTER = 16
# A proposal is only good for a short while: "yes" to something proposed yesterday
# is not consent to book it today.
ACTION_TTL = dt.timedelta(minutes=30)


def _now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def add_message(principal_id: str, role: str, text: str, *, vin: str | None = None,
                channel: str | None = None) -> int:
    with SessionLocal() as s:
        row = AssistantMessage(principal_id=principal_id, role=role, text=text, vin=vin,
                               channel=channel, created_at=_now())
        s.add(row)
        s.commit()
        return row.id


def _msg(m: AssistantMessage) -> dict:
    return {"id": m.id, "role": m.role, "text": m.text, "vin": m.vin, "channel": m.channel,
            "at": m.created_at.isoformat() if m.created_at else None}


def recent(principal_id: str, limit: int = RECENT_TURNS) -> list[dict]:
    with SessionLocal() as s:
        rows = s.execute(select(AssistantMessage).where(AssistantMessage.principal_id == principal_id)
                         .order_by(AssistantMessage.id.desc()).limit(limit)).scalars().all()
    return [_msg(m) for m in reversed(rows)]


def thread(principal_id: str, limit: int = 60) -> list[dict]:
    return recent(principal_id, limit)


def memory(principal_id: str) -> dict:
    with SessionLocal() as s:
        row = s.get(AssistantMemory, principal_id)
        return {"summary": row.summary, "summarised_to": row.summarised_to} if row \
            else {"summary": "", "summarised_to": 0}


def backlog(principal_id: str) -> list[dict]:
    """Turns past the memory mark and older than the verbatim window."""
    mem = memory(principal_id)
    with SessionLocal() as s:
        rows = s.execute(select(AssistantMessage)
                         .where(AssistantMessage.principal_id == principal_id,
                                AssistantMessage.id > mem["summarised_to"])
                         .order_by(AssistantMessage.id.asc())).scalars().all()
    older = rows[:-RECENT_TURNS] if len(rows) > RECENT_TURNS else []
    return [_msg(m) for m in older]


def save_memory(principal_id: str, summary: str, summarised_to: int) -> None:
    with SessionLocal() as s:
        row = s.get(AssistantMemory, principal_id)
        if row is None:
            s.add(AssistantMemory(principal_id=principal_id, summary=summary,
                                  summarised_to=summarised_to, updated_at=_now()))
        else:
            row.summary, row.summarised_to, row.updated_at = summary, summarised_to, _now()
        s.commit()


def clear(principal_id: str) -> None:
    """Forget everything: the thread, the memory, anything still waiting for a yes."""
    with SessionLocal() as s:
        s.execute(delete(AssistantMessage).where(AssistantMessage.principal_id == principal_id))
        s.execute(delete(AssistantMemory).where(AssistantMemory.principal_id == principal_id))
        s.execute(update(AssistantAction)
                  .where(AssistantAction.principal_id == principal_id, AssistantAction.status == "pending")
                  .values(status="cancelled", decided_at=_now()))
        s.commit()


# ── proposed actions ───────────────────────────────────────────────────────

def _action(a: AssistantAction) -> dict:
    return {"id": a.id, "kind": a.kind, "vin": a.vin, "params": a.params or {},
            "summary": a.summary, "status": a.status}


def propose_action(principal_id: str, kind: str, vin: str, params: dict, summary: str) -> dict:
    """Record a proposal. A newer one replaces any still waiting: only one thing is
    ever asked of the owner at a time, so a bare "yes" can mean only one thing."""
    with SessionLocal() as s:
        s.execute(update(AssistantAction)
                  .where(AssistantAction.principal_id == principal_id, AssistantAction.status == "pending")
                  .values(status="superseded", decided_at=_now()))
        row = AssistantAction(principal_id=principal_id, kind=kind, vin=vin, params=params,
                              summary=summary, status="pending", created_at=_now())
        s.add(row)
        s.commit()
        return _action(row)


def pending_action(principal_id: str) -> dict | None:
    with SessionLocal() as s:
        row = s.execute(select(AssistantAction)
                        .where(AssistantAction.principal_id == principal_id,
                               AssistantAction.status == "pending")
                        .order_by(AssistantAction.created_at.desc()).limit(1)).scalar_one_or_none()
        if row is None:
            return None
        if _now() - row.created_at > ACTION_TTL:
            row.status, row.decided_at = "expired", _now()
            s.commit()
            return None
        return _action(row)


def get_action(action_id: str, principal_id: str) -> dict | None:
    with SessionLocal() as s:
        row = s.get(AssistantAction, action_id)
        # Someone else's proposal is indistinguishable from one that does not exist.
        return _action(row) if row and row.principal_id == principal_id else None


def decide_action(action_id: str, principal_id: str, status: str) -> bool:
    """Move a PENDING action to `status`. False if it was not pending any more, which is
    what makes a double tap on "Yes" book once, not twice."""
    with SessionLocal() as s:
        result = s.execute(update(AssistantAction)
                           .where(AssistantAction.id == action_id,
                                  AssistantAction.principal_id == principal_id,
                                  AssistantAction.status == "pending")
                           .values(status=status, decided_at=_now()))
        s.commit()
        return result.rowcount == 1
