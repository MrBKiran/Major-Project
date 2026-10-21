"""
The car's screen: what a head unit (the web console's, or Android Auto) may
show right now, and booking from it.

The server is the only authority on drive state (PROJECT_PLAN §2A.5): it is
read from the car's latest telemetry, never taken from the client. When that
reading is missing, stale or self-contradictory the car is treated as moving —
the direction in which a wrong guess costs a delay, not a crash.

What may be shown in a state comes from the same G6/G7 rules the guard
enforces (config/agent_policy.yaml), read without invoking anything, so a
screen that polls cannot trip a block. The one irreversible action — booking —
does go through the guard: scheduler.confirm is itself covered by G6.
"""

from __future__ import annotations

import datetime as dt
import uuid

from fastapi import HTTPException
from sqlalchemy import text

from app.db.scheduling import get_open_slots
from app.db.session import engine
from app.graph.master import BOOKING_PLAN_ADDITIONS
from app.owner_service import alert_for, booking_for, economics_for
from app.owner_service import vehicle as _vehicle
from app.tools.registry import ToolBlocked, ToolContext, invoke
from app.ueba.policy import engine as guard

# A reading older than this says nothing about what the car is doing now.
STALE_AFTER_S = 120
# Above this, a car reporting PARKED is not parked — trust the speed.
MOVING_KMPH = 3.0
PARKED_STATES = {"PARKED", "IGNITION_OFF"}
SLOTS_OFFERED = 3

MASTER_ID = "master_agent"
SCHEDULING_ID = "scheduling_agent"


def drive_state(vin: str) -> dict:
    """{state, basis, speed_kmph, observed_at}. `state` is one the guard knows —
    PARKED, STOPPED_BRIEF or DRIVING — never "unknown", because G6 only blocks
    the states it lists and an unlisted one would sail through."""
    with engine.connect() as c:
        row = c.execute(text("SELECT ts, drive_state, speed FROM telemetry WHERE vin = :v "
                             "ORDER BY ts DESC LIMIT 1"), {"v": vin}).first()
    if row is None:
        return {"state": "DRIVING", "basis": "none", "speed_kmph": None, "observed_at": None}

    seen = {"speed_kmph": row.speed, "observed_at": row.ts.isoformat()}
    age = (dt.datetime.now(dt.timezone.utc) - row.ts).total_seconds()
    if age > STALE_AFTER_S:
        return {"state": "DRIVING", "basis": "stale", **seen}

    reported = (row.drive_state or "").upper()
    if reported in PARKED_STATES:
        if (row.speed or 0) > MOVING_KMPH:
            return {"state": "DRIVING", "basis": "contradiction", **seen}
        return {"state": "PARKED", "basis": "telemetry", **seen}
    if reported == "STOPPED_BRIEF":
        return {"state": "STOPPED_BRIEF", "basis": "telemetry", **seen}
    return {"state": "DRIVING", "basis": "telemetry", **seen}


def allowed_in(state: str) -> dict:
    return {
        "touch": not guard.drive_state_blocks("console.request_touch", state),
        "slots": not guard.drive_state_blocks("console.show_slots", state),
        "max_elements": guard.element_cap(state),
    }


def screen(vin: str) -> dict:
    vehicle = _vehicle(vin)
    drive = drive_state(vin)
    allowed = allowed_in(drive["state"])
    alert = alert_for(vin)
    booking = booking_for(vin)

    slots = []
    # Not merely hidden while moving: never sent, so no client can render them.
    if alert and not booking and allowed["slots"] and vehicle.city:
        slots = get_open_slots(city=vehicle.city, days=14)[:SLOTS_OFFERED]

    return {
        "vin": vin, "model": vehicle.model, "odometer": vehicle.odometer, "city": vehicle.city,
        "drive": drive, "allowed": allowed, "alert": alert,
        "economics": economics_for(alert),
        "booking": booking,
        "slots": slots,
    }


async def book(vin: str, center_id: str, slot_start: str) -> dict:
    drive = drive_state(vin)
    if drive["state"] != "PARKED":
        raise HTTPException(409, "park the car to book — the screen accepts no taps while moving")

    vehicle = _vehicle(vin)
    with engine.connect() as c:
        centre_city = c.execute(text("SELECT city FROM service_centers WHERE id = :c"),
                                {"c": center_id}).scalar()
    if centre_city is None or centre_city != vehicle.city:
        raise HTTPException(422, "that centre is not one offered for this car")

    run_id = f"car-{uuid.uuid4().hex[:8]}"
    car = {"vin": vin, "drive_state": drive["state"], "speed_kmph": drive["speed_kmph"]}
    master_ctx = ToolContext(run_id=run_id, agent_id=MASTER_ID, **car)
    sched_ctx = ToolContext(run_id=run_id, agent_id=SCHEDULING_ID, **car)
    try:
        # scheduler.confirm is irreversible, so it must be in a declared plan.
        await invoke(MASTER_ID, "runs.write_plan", {
            "steps": BOOKING_PLAN_ADDITIONS,
            "rationale": f"Owner tapped Book on the car screen for {vin} while parked.",
        }, master_ctx)
        held = (await invoke(SCHEDULING_ID, "scheduler.hold",
                             {"center_id": center_id, "slot_start": slot_start, "vin": vin},
                             sched_ctx)).data or {}
        if held.get("existing"):
            return {"booked": True, "already_booked": True, **held["existing"]}
        if not held.get("held"):
            raise HTTPException(409, held.get("error") or "that slot is no longer free")
        confirmed = (await invoke(SCHEDULING_ID, "scheduler.confirm",
                                  {"center_id": center_id, "slot_start": slot_start, "vin": vin},
                                  sched_ctx)).data or {}
    except ToolBlocked as e:
        raise HTTPException(409, f"the guard refused the booking: {e}") from None

    if not confirmed.get("booked"):
        raise HTTPException(409, confirmed.get("error") or "the booking did not go through")
    return {"booked": True, "already_booked": False, **confirmed}


def simulate(vin: str, state: str) -> dict:
    """Demo only: record a reading in the given state, as the car would. The
    console's drive-state control used to send its own state with each request;
    now it changes what the server sees, and the server still decides."""
    speed = {"PARKED": 0.0, "IGNITION_OFF": 0.0, "STOPPED_BRIEF": 0.0, "DRIVING": 68.0}[state]
    with engine.begin() as c:
        c.execute(text("INSERT INTO telemetry (ts, vin, speed, drive_state) VALUES (now(), :v, :s, :d)"),
                  {"v": vin, "s": speed, "d": state})
    return drive_state(vin)
