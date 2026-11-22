"""What the assistant's model may look at, and what it may PROPOSE.

Every tool is scoped to the person asking: a VIN they do not own answers exactly as
a VIN that does not exist. Read tools return plain facts in the owner's words
("Soon", "brake pads"), not engineering identifiers. The three `propose_*` tools
change nothing — they record what would happen and leave the decision to the owner
(store.propose_action), because a language model that can book is a language model
that can be talked into booking.
"""

from __future__ import annotations

import asyncio
import datetime as dt
from dataclasses import dataclass

from sqlalchemy import text

from app import owner_service
from app.assistant import store
from app.auth.principal import Principal
from app.auth.scope import can_access_vin, vin_predicate
from app.db import queries
from app.db.scheduling import _to_ist, get_open_slots
from app.db.session import engine
from app.llm.answering import COMPONENT_LABELS

SEVERITY_WORDS = {"P1": "Urgent", "P2": "Soon", "P3": "Worth watching"}

READING_LABELS = {
    "coolant_temp": ("Engine temperature", "°C"),
    "lub_oil_pressure": ("Oil pressure", "bar"),
    "lub_oil_temp": ("Oil temperature", "°C"),
    "fuel_pressure": ("Fuel pressure", "bar"),
    "battery_voltage": ("Battery voltage", "V"),
    "tyre_pressure": ("Tyre pressure", "psi"),
    "brake_fluid_pct": ("Brake fluid level", "%"),
    "engine_rpm": ("Engine speed", "rpm"),
    "speed": ("Speed", "km/h"),
}


def fmt_slot(iso: str) -> str:
    """'Mon 23 Nov, 9:00 am' — how an owner says it, in Indian time."""
    when = _to_ist(dt.datetime.fromisoformat(iso))
    hour = when.strftime("%I").lstrip("0") or "12"
    return f"{when:%a} {when.day} {when:%b}, {hour}:{when:%M} {'am' if when.hour < 12 else 'pm'}"


@dataclass
class ToolContext:
    principal: Principal

    def can_write(self) -> bool:
        return self.principal.can("appointment:write")


def _label(component: str | None) -> str | None:
    return COMPONENT_LABELS.get(component, (component or "").replace("_", " ")) if component else None


def _vehicles(principal: Principal) -> list[dict]:
    scope = vin_predicate(principal)
    sql = "SELECT v.vin, v.model, v.odometer, v.city FROM vehicles v WHERE " + \
          scope.sql.replace("{alias}", "v") + " ORDER BY v.model, v.vin LIMIT 20"
    with engine.connect() as conn:
        return [dict(r._mapping) for r in conn.execute(text(sql), scope.params)]


def summary_of(v: dict) -> dict:
    alert = owner_service.alert_for(v["vin"])
    booking = owner_service.booking_for(v["vin"])
    out = {"vin": v["vin"], "model": v["model"], "city": v["city"], "odometer_km": v["odometer"]}
    if alert:
        out["warning"] = {"part": _label(alert["component"]),
                          "how_soon": SEVERITY_WORDS.get(alert["severity"], alert["severity"]),
                          "days_of_driving_left": round(alert["days_to_failure"], 1)
                          if alert["days_to_failure"] is not None else None}
        econ = owner_service.economics_for(alert)
        if econ:
            out["warning"]["repair_now_inr"] = econ["repair_inr"]
            out["warning"]["if_it_fails_on_the_road_inr"] = econ["breakdown_inr"]
    else:
        out["warning"] = None
    out["booking"] = ({"when": fmt_slot(booking["slot_start"]), "at": booking["center_name"],
                       "area": booking["city"], "slot_start": booking["slot_start"],
                       "center_id": booking["center_id"]} if booking else None)
    return out


def _own(ctx: ToolContext, vin: str) -> bool:
    return isinstance(vin, str) and can_access_vin(ctx.principal, vin)


_NOT_YOURS = {"error": "I can't find that vehicle among yours."}


# ── read tools ─────────────────────────────────────────────────────────────

def list_vehicles(ctx: ToolContext, **_) -> dict:
    return {"vehicles": [summary_of(v) for v in _vehicles(ctx.principal)]}


def vehicle_status(ctx: ToolContext, vin: str = "", **_) -> dict:
    if not _own(ctx, vin):
        return _NOT_YOURS
    car = owner_service.vehicle(vin)
    return summary_of({"vin": vin, "model": car.model, "odometer": car.odometer, "city": car.city})


def service_history(ctx: ToolContext, vin: str = "", limit: int = 5, **_) -> dict:
    if not _own(ctx, vin):
        return _NOT_YOURS
    rows = queries.maintenance_history(vin, limit=max(1, min(int(limit or 5), 10)))
    return {"visits": [{"date": r["date"], "service": r["service_type"],
                        "parts_replaced": [_label(c) for c in (r["components_replaced"] or [])],
                        "cost_inr": r["cost"], "odometer_km": r["km_at_service"]} for r in rows]}


def latest_readings(ctx: ToolContext, vin: str = "", **_) -> dict:
    if not _own(ctx, vin):
        return _NOT_YOURS
    df = queries.telemetry_window(vin, 24 * 60)
    if df.empty:
        return {"readings": None, "note": "No readings from the car in the last 24 hours."}
    last = df.iloc[-1]
    readings = {}
    for col, (label, unit) in READING_LABELS.items():
        value = last.get(col)
        if value is not None and value == value:          # NaN is the only value != itself
            readings[label] = f"{float(value):.1f} {unit}"
    codes = next((list(c) for c in reversed(df["dtc_codes"].tolist()) if c is not None and len(c)), [])
    return {"as_of": str(last["ts"]), "readings": readings, "fault_codes": codes[:5]}


def fault_code(ctx: ToolContext, code: str = "", **_) -> dict:
    row = queries.dtc_lookup(str(code).strip().upper()[:8])
    return row or {"error": "I don't have that fault code on file."}


def open_slots(ctx: ToolContext, vin: str = "", **_) -> dict:
    if not _own(ctx, vin):
        return _NOT_YOURS
    car = owner_service.vehicle(vin)
    here = owner_service.booking_for(vin)
    slots = [s for s in get_open_slots(city=car.city, days=14)
             if not here or (s["center_id"], s["slot_start"]) != (here["center_id"], here["slot_start"])]
    return {"slots": [{"center_id": s["center_id"], "centre": s["center_name"], "when": fmt_slot(s["slot_start"]),
                       "slot_start": s["slot_start"]} for s in slots[:owner_service.SLOTS_OFFERED]]}


# ── propose tools: they record, they never act ─────────────────────────────

def _propose(ctx: ToolContext, kind: str, vin: str, params: dict, summary: str) -> dict:
    action = store.propose_action(ctx.principal.user_id, kind, vin, params, summary)
    return {"proposed": True, "summary": summary, "action_id": action["id"],
            "next": "Ask the owner to confirm. Nothing has been done yet."}


def _slot_ok(vin: str, center_id: str, slot_start: str) -> dict | None:
    car = owner_service.vehicle(vin)
    here = owner_service.booking_for(vin)
    for s in get_open_slots(city=car.city, days=14):
        if s["center_id"] == center_id and s["slot_start"] == slot_start \
                and not (here and (here["center_id"], here["slot_start"]) == (center_id, slot_start)):
            return s
    return None


def propose_booking(ctx: ToolContext, vin: str = "", center_id: str = "", slot_start: str = "", **_) -> dict:
    if not ctx.can_write():
        return {"error": "This account can't make bookings."}
    if not _own(ctx, vin):
        return _NOT_YOURS
    if owner_service.booking_for(vin):
        return {"error": "This car already has a booking. Offer to move it instead."}
    slot = _slot_ok(vin, center_id, slot_start)
    if not slot:
        return {"error": "That slot is not open. Use open_slots to see what is."}
    car = owner_service.vehicle(vin)
    return _propose(ctx, "book", vin, {"center_id": center_id, "slot_start": slot_start},
                    f"Book the {car.model} at {slot['center_name']} on {fmt_slot(slot_start)}")


def propose_reschedule(ctx: ToolContext, vin: str = "", center_id: str = "", slot_start: str = "", **_) -> dict:
    if not ctx.can_write():
        return {"error": "This account can't change bookings."}
    if not _own(ctx, vin):
        return _NOT_YOURS
    here = owner_service.booking_for(vin)
    if not here:
        return {"error": "This car has no booking to move. Offer to book instead."}
    slot = _slot_ok(vin, center_id, slot_start)
    if not slot:
        return {"error": "That slot is not open. Use open_slots to see what is."}
    car = owner_service.vehicle(vin)
    return _propose(ctx, "reschedule", vin, {"center_id": center_id, "slot_start": slot_start},
                    f"Move the {car.model}'s booking from {fmt_slot(here['slot_start'])} to "
                    f"{fmt_slot(slot_start)} at {slot['center_name']}")


def propose_cancel(ctx: ToolContext, vin: str = "", **_) -> dict:
    if not ctx.can_write():
        return {"error": "This account can't change bookings."}
    if not _own(ctx, vin):
        return _NOT_YOURS
    here = owner_service.booking_for(vin)
    if not here:
        return {"error": "This car has no booking to cancel."}
    car = owner_service.vehicle(vin)
    return _propose(ctx, "cancel", vin, {},
                    f"Cancel the {car.model}'s booking on {fmt_slot(here['slot_start'])} at {here['center_name']}")


_VIN = {"vin": {"type": "string", "description": "The vehicle's VIN, exactly as list_vehicles gave it."}}
_SLOT = {"center_id": {"type": "string"},
         "slot_start": {"type": "string", "description": "The slot_start value exactly as open_slots gave it."}}


def _spec(name: str, description: str, props: dict | None = None, required: list | None = None) -> dict:
    return {"type": "function", "function": {"name": name, "description": description,
            "parameters": {"type": "object", "properties": props or {}, "required": required or []}}}


SPECS = [
    _spec("list_vehicles", "All of the owner's vehicles with any warning, its cost, and any booking. Start here."),
    _spec("vehicle_status", "One vehicle's warning, repair cost versus breakdown cost, and booking.", _VIN, ["vin"]),
    _spec("service_history", "Past service visits for one vehicle: dates, work done, cost.",
          {**_VIN, "limit": {"type": "integer"}}, ["vin"]),
    _spec("latest_readings", "The car's most recent sensor readings (temperature, battery, oil, brakes) and any fault codes.",
          _VIN, ["vin"]),
    _spec("fault_code", "What a dashboard fault code (like P0300) means.", {"code": {"type": "string"}}, ["code"]),
    _spec("open_slots", "Service slots currently open for one vehicle.", _VIN, ["vin"]),
    _spec("propose_booking", "PROPOSE booking a service slot. Does nothing until the owner says yes.",
          {**_VIN, **_SLOT}, ["vin", "center_id", "slot_start"]),
    _spec("propose_reschedule", "PROPOSE moving an existing booking to another slot. Does nothing until the owner says yes.",
          {**_VIN, **_SLOT}, ["vin", "center_id", "slot_start"]),
    _spec("propose_cancel", "PROPOSE cancelling a vehicle's booking. Does nothing until the owner says yes.", _VIN, ["vin"]),
]

_RUNNERS = {f.__name__: f for f in (list_vehicles, vehicle_status, service_history, latest_readings,
            fault_code, open_slots, propose_booking, propose_reschedule, propose_cancel)}


async def run_tool(ctx: ToolContext, name: str, args: dict) -> dict:
    """Run one tool by name. Never raises: a failure is a result the model can read."""
    fn = _RUNNERS.get(name)
    if fn is None:
        return {"error": f"unknown tool {name}"}
    try:
        return await asyncio.to_thread(fn, ctx, **(args if isinstance(args, dict) else {}))
    except TypeError:
        return {"error": "bad arguments"}
    except Exception as exc:  # noqa: BLE001 — a broken lookup costs the model one fact, not the turn
        return {"error": f"could not look that up ({type(exc).__name__})"}
