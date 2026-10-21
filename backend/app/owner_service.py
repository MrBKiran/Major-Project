"""
Service for one car, as its owner sees it on the phone: the alert, what it
costs, the booking, and booking, moving or cancelling it directly.

The car screen (app/car.py) shows the same alert and booking but is governed by
drive state; the phone is not the car's display and is not. What every path
shares is the scheduling layer's rule of one upcoming booking per vehicle.
"""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import text

from app.db.scheduling import (
    ACTIVE_STATUSES, _to_ist, cancel_upcoming, confirm_appointment, get_open_slots, hold_slot,
    reschedule_appointment,
)
from app.db.session import engine
from app.llm.persuasion import component_economics

SLOTS_OFFERED = 6
BOOKED_BY = "owner_app"


def vehicle(vin: str):
    with engine.connect() as c:
        return c.execute(text("SELECT vin, model, odometer, city FROM vehicles WHERE vin = :v"),
                         {"v": vin}).first()


def alert_for(vin: str) -> dict | None:
    """The car's most likely failure with a severity, if any."""
    with engine.connect() as c:
        p = c.execute(text("SELECT component, severity, days_to_failure FROM predictions "
                           "WHERE vin = :v AND severity IS NOT NULL "
                           "ORDER BY failure_prob DESC, ts DESC LIMIT 1"), {"v": vin}).first()
    if p is None:
        return None
    return {"component": p.component, "severity": p.severity, "days_to_failure": p.days_to_failure}


def booking_for(vin: str) -> dict | None:
    """The car's next appointment, held or booked."""
    with engine.connect() as c:
        a = c.execute(text(
            "SELECT a.id, a.center_id, sc.name, sc.city, a.slot_start, a.status "
            "FROM appointments a JOIN service_centers sc ON sc.id = a.center_id "
            "WHERE a.vin = :v AND a.status = ANY(:s) AND a.slot_start > now() "
            "ORDER BY a.slot_start LIMIT 1"), {"v": vin, "s": list(ACTIVE_STATUSES)}).first()
    if a is None:
        return None
    return {"appointment_id": a.id, "center_id": a.center_id, "center_name": a.name,
            "city": a.city, "slot_start": _to_ist(a.slot_start).isoformat(), "status": a.status}


def economics_for(alert: dict | None) -> dict | None:
    """Repair vs. breakdown cost from vehicles.yaml — the pair the agent quotes."""
    econ = component_economics(alert["component"]) if alert else None
    return {"repair_inr": econ["repair_cost"], "breakdown_inr": econ["breakdown_cost"]} if econ else None


def view(vin: str) -> dict:
    car = vehicle(vin)
    alert = alert_for(vin)
    booking = booking_for(vin)
    slots = []
    # Quiet when healthy: slots only when there is something to book or move.
    if (alert or booking) and car.city:
        here = (booking["center_id"], booking["slot_start"]) if booking else None
        slots = [s for s in get_open_slots(city=car.city, days=14)
                 if (s["center_id"], s["slot_start"]) != here][:SLOTS_OFFERED]
    return {"vin": vin, "model": car.model, "odometer": car.odometer, "city": car.city,
            "alert": alert, "economics": economics_for(alert), "booking": booking, "slots": slots}


def _same_city(vin: str, center_id: str) -> None:
    with engine.connect() as c:
        centre_city = c.execute(text("SELECT city FROM service_centers WHERE id = :c"),
                                {"c": center_id}).scalar()
    if centre_city is None or centre_city != vehicle(vin).city:
        raise HTTPException(422, "that centre is not one offered for this car")


def book(vin: str, center_id: str, slot_start: str) -> dict:
    _same_city(vin, center_id)
    held = hold_slot(center_id, slot_start, vin)
    if held.get("existing"):
        raise HTTPException(409, {"error": "this car already has an upcoming booking — move it instead",
                                  "booking": held["existing"]})
    if not held.get("held"):
        raise HTTPException(409, {"error": held.get("error") or "that slot is no longer free"})
    confirmed = confirm_appointment(vin, center_id, slot_start, created_by_agent=BOOKED_BY)
    if not confirmed.get("booked"):
        raise HTTPException(409, {"error": confirmed.get("error") or "the booking did not go through"})
    return {"booking": booking_for(vin)}


def reschedule(vin: str, center_id: str, slot_start: str) -> dict:
    _same_city(vin, center_id)
    moved = reschedule_appointment(vin, center_id, slot_start, created_by=BOOKED_BY)
    if not moved.get("moved"):
        raise HTTPException(409, {"error": moved.get("error"), "booking": moved.get("existing")})
    return {"booking": booking_for(vin)}


def cancel(vin: str) -> dict:
    result = cancel_upcoming(vin)
    if not result.get("cancelled"):
        raise HTTPException(404, result.get("error") or "no upcoming booking")
    return {"cancelled": True}
