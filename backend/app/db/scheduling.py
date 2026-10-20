"""Scheduler DB operations — backs the scheduler.* tools in tools/core.py."""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import select

from app.db.models import Appointment, CapacitySlot, Feedback, ServiceCenter, ServiceJob, Vehicle
from app.db.session import SessionLocal

HOLD_MINUTES = 10
# An appointment in either state occupies a bay and counts as the vehicle's
# upcoming visit. Once its slot time has passed it is history, booked or not.
ACTIVE_STATUSES = ("held", "booked")

# Postgres stores TIMESTAMPTZ normalized to UTC and hands it back tz-aware in
# UTC. Everything user-facing (slot times shown to owners, `pref_time_window`
# matching) is Indian local time, so convert on the way out of the DB — see
# seed.py's IST note.
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def _to_ist(value: dt.datetime) -> dt.datetime:
    if value.tzinfo is None:
        value = value.replace(tzinfo=dt.timezone.utc)
    return value.astimezone(IST)


def get_open_slots(center_id: str | None = None, city: str | None = None,
                    from_date: str | None = None, days: int = 7,
                    skill: str | None = None, limit: int = 200) -> list[dict]:
    """Distinct bookable (centre, start) times in the window.

    Capacity is seeded as several identical rows per hour to model parallel
    bays, but an offer only needs each distinct time once — collapsing them
    keeps the candidate pool spanning the whole window instead of the limit
    being consumed by duplicates of the first morning. The pool has to reach
    the weekend, because an owner who can only come Saturday is served by
    re-ranking these candidates rather than by a fresh query.
    """
    start = dt.datetime.fromisoformat(from_date) if from_date else dt.datetime.now(dt.timezone.utc)
    start = start.replace(tzinfo=dt.timezone.utc) if start.tzinfo is None else start
    end = start + dt.timedelta(days=days)

    with SessionLocal() as session:
        q = (
            select(
                CapacitySlot.center_id, ServiceCenter.name, ServiceCenter.city,
                CapacitySlot.slot_start, CapacitySlot.slot_end,
            )
            .join(ServiceCenter, CapacitySlot.center_id == ServiceCenter.id)
            .where(CapacitySlot.status == "open")
            .where(CapacitySlot.slot_start >= start)
            .where(CapacitySlot.slot_start <= end)
            .distinct()
        )
        if center_id:
            q = q.where(CapacitySlot.center_id == center_id)
        if city:
            q = q.where(ServiceCenter.city == city)
        if skill:
            q = q.where(ServiceCenter.skills.any(skill))
        q = q.order_by(CapacitySlot.slot_start.asc()).limit(limit)

        return [
            {"center_id": cid, "center_name": name, "city": city_,
             "slot_start": _to_ist(s_start).isoformat(), "slot_end": _to_ist(s_end).isoformat()}
            for cid, name, city_, s_start, s_end in session.execute(q).all()
        ]


def _upcoming(session, vin: str) -> list[Appointment]:
    return list(session.execute(
        select(Appointment).where(
            Appointment.vin == vin, Appointment.status.in_(ACTIVE_STATUSES),
            Appointment.slot_start > dt.datetime.now(dt.timezone.utc),
        )
    ).scalars())


def _release_bay(session, center_id: str, slot_start: dt.datetime, status: str) -> None:
    """Reopen one bay at this time that is in `status` — never one already open,
    or the bay the appointment actually held would stay taken."""
    bay = session.execute(
        select(CapacitySlot).where(
            CapacitySlot.center_id == center_id, CapacitySlot.slot_start == slot_start,
            CapacitySlot.status == status,
        ).limit(1)
    ).scalar_one_or_none()
    if bay:
        bay.status = "open"


def _describe(session, appt: Appointment) -> dict:
    centre = session.get(ServiceCenter, appt.center_id)
    return {"appointment_id": appt.id, "center_id": appt.center_id,
            "center_name": centre.name if centre else appt.center_id,
            "slot_start": _to_ist(appt.slot_start).isoformat(), "status": appt.status}


def hold_slot(center_id: str, slot_start: str, vin: str) -> dict:
    """Hold a bay for `vin`, keeping the vehicle to one upcoming appointment.

    A vehicle that is already booked is refused, and told which booking it has.
    An unconfirmed hold for the same vehicle is replaced and its bay reopened:
    that is an owner changing their mind before confirming, not a second visit.
    """
    start = dt.datetime.fromisoformat(slot_start)
    with SessionLocal() as session:
        # Serialises bookings for one vehicle. Without it, two "yes"es arriving
        # together both pass the check below and the car is booked twice.
        if session.get(Vehicle, vin, with_for_update=True) is None:
            return {"held": False, "error": f"unknown vin {vin}"}

        upcoming = _upcoming(session, vin)
        booked = next((a for a in upcoming if a.status == "booked"), None)
        if booked is not None:
            return {"held": False, "error": "this vehicle already has an upcoming booking",
                    "existing": _describe(session, booked)}

        slot = session.execute(
            select(CapacitySlot)
            .where(CapacitySlot.center_id == center_id, CapacitySlot.slot_start == start,
                   CapacitySlot.status == "open")
            .limit(1)
        ).scalar_one_or_none()
        if slot is None:
            return {"held": False, "error": "no open slot at that time"}

        for stale in upcoming:
            stale.status = "cancelled"
            _release_bay(session, stale.center_id, stale.slot_start, "held")

        slot.status = "held"
        appt = Appointment(
            id=f"APT-{uuid.uuid4().hex[:10]}", vin=vin, center_id=center_id,
            slot_start=start, status="held",
        )
        session.add(appt)
        session.commit()
        return {"held": True, "appointment_id": appt.id, "expires_in_s": HOLD_MINUTES * 60}


def confirm_appointment(vin: str, center_id: str, slot_start: str,
                         created_by_agent: str | None = None, run_id: str | None = None) -> dict:
    start = dt.datetime.fromisoformat(slot_start)
    with SessionLocal() as session:
        appt = session.execute(
            select(Appointment).where(
                Appointment.vin == vin, Appointment.center_id == center_id,
                Appointment.slot_start == start, Appointment.status == "held",
            ).order_by(Appointment.id.desc()).limit(1)
        ).scalar_one_or_none()
        if not appt:
            return {"booked": False, "error": "no held appointment for that vin/centre/slot"}
        appt.status = "booked"
        appt.created_by_agent = created_by_agent
        appt.run_id = run_id
        slot = session.execute(
            select(CapacitySlot).where(
                CapacitySlot.center_id == appt.center_id, CapacitySlot.slot_start == appt.slot_start,
                CapacitySlot.status == "held",
            ).limit(1)
        ).scalar_one_or_none()
        if slot:
            slot.status = "booked"
        session.commit()
        return {"booked": True, "appointment_id": appt.id,
                "center_id": appt.center_id,
                "slot_start": _to_ist(appt.slot_start).isoformat()}


def complete_service(appointment_id: str, parts_used: list[str] | None = None,
                      cost: float | None = None) -> dict:
    """Mark the workshop job done — the trigger for post-service feedback."""
    with SessionLocal() as session:
        appt = session.get(Appointment, appointment_id)
        if not appt:
            return {"completed": False, "error": "unknown appointment_id"}
        now = dt.datetime.now(dt.timezone.utc)
        job = session.execute(
            select(ServiceJob).where(ServiceJob.appointment_id == appointment_id).limit(1)
        ).scalar_one_or_none()
        if job is None:
            job = ServiceJob(id=f"JOB-{uuid.uuid4().hex[:10]}", appointment_id=appointment_id,
                              started_at=now)
            session.add(job)
        job.status = "completed"
        job.completed_at = now
        job.parts_used = parts_used or []
        job.cost = cost
        appt.status = "completed"
        session.commit()
        return {"completed": True, "job_id": job.id, "vin": appt.vin,
                "appointment_id": appointment_id}


def record_feedback(appointment_id: str, csat: int, nps: int | None = None,
                     verbatim: str = "") -> dict:
    with SessionLocal() as session:
        if not session.get(Appointment, appointment_id):
            return {"recorded": False, "error": "unknown appointment_id"}
        fb = Feedback(id=f"FB-{uuid.uuid4().hex[:10]}", appointment_id=appointment_id,
                       csat=csat, nps=nps, verbatim=verbatim)
        session.add(fb)
        session.commit()
        return {"recorded": True, "feedback_id": fb.id, "csat": csat}


def append_service_record(vin: str, service_type: str, notes: str = "",
                           components_replaced: list[str] | None = None,
                           cost_inr: float | None = None) -> dict:
    from app.db.models import MaintenanceHistory, Vehicle

    with SessionLocal() as session:
        vehicle = session.get(Vehicle, vin)
        if not vehicle:
            return {"written": False, "error": f"unknown vin {vin}"}
        rec = MaintenanceHistory(
            id=f"MH-{uuid.uuid4().hex[:12]}", vin=vin, date=dt.date.today(),
            service_type=service_type, components_replaced=components_replaced or [],
            cost=cost_inr, technician_notes=notes, km_at_service=vehicle.odometer,
        )
        session.add(rec)
        session.commit()
        return {"written": True, "record_id": rec.id, "vin": vin}


def cancel_appointment(appointment_id: str, reason: str = "") -> dict:
    with SessionLocal() as session:
        appt = session.get(Appointment, appointment_id)
        if not appt:
            return {"cancelled": False, "error": "unknown appointment_id"}
        if appt.status in ACTIVE_STATUSES:
            _release_bay(session, appt.center_id, appt.slot_start, appt.status)
        appt.status = "cancelled"
        session.commit()
        return {"cancelled": True, "appointment_id": appointment_id, "reason": reason}
