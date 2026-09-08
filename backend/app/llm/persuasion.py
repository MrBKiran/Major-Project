"""
Assembles the template variables config/strategies.yaml's strings need, then
calls the LLM router. This is the "LLM decides: persuasion strategy" half of
PROJECT_PLAN §5.2 — strategy *selection* (which one to try, and what to try
next after an objection) happens in the Customer Engagement Agent node; this
module owns turning (strategy, context) into spoken text.

Every rupee figure and repair duration is read from simulator/vehicles.yaml at
import time rather than hand-copied here. These numbers get spoken aloud in the
demo and printed on slides, so a duplicated constant that drifts from the
screenplay is a live-demo hazard.
"""

from __future__ import annotations

import asyncio
from functools import lru_cache
from pathlib import Path
from typing import Any

import yaml

from app.db.queries import customer_for_vin, vehicle_info
from app.llm.router import complete

ROOT = Path(__file__).resolve().parents[3]
VEHICLES_YAML = ROOT / "simulator" / "vehicles.yaml"

# component → (owner-facing label, telemetry field, unit, drift direction).
# Direction comes from the `drivers` ramps in vehicles.yaml: coolant temp ramps
# UP as the water pump fails, while oil/fuel pressure and brake fluid ramp DOWN.
# It decides whether the worst reading is the max or the min of the window.
COMPONENT_SIGNAL = {
    "water_pump": ("coolant temperature", "coolant_temp", "°C", "up"),
    "battery": ("battery voltage", "battery_voltage", "V", "down"),
    "brake_pads": ("brake fluid level", "brake_fluid_pct", "%", "down"),
    "fuel_injector": ("fuel pressure", "fuel_pressure", " bar", "down"),
    "oil_pump": ("oil pressure", "lub_oil_pressure", " bar", "down"),
}

# Below this the engine is idling or off, and every pressure/temperature signal
# collapses toward zero for reasons that have nothing to do with wear. Quoting
# one of those as evidence of a fault would be plainly wrong.
ENGINE_RUNNING_RPM = 500

DRIVE_CYCLE_LABEL = {
    "highway_taxi": "highway route", "city_commute": "city commute",
    "urban_delivery": "delivery route", "mixed_fleet": "regular route",
    "weekend_leisure": "weekend drives",
}


@lru_cache(maxsize=1)
def _component_economics() -> dict[str, dict]:
    """component -> {label, repair_cost, repair_minutes, breakdown_cost, horizon_days}"""
    doc = yaml.safe_load(VEHICLES_YAML.read_text(encoding="utf-8"))
    out = {}
    for spec in doc["degradations"].values():
        repair = spec.get("repair") or {}
        out[spec["component"]] = {
            "label": spec["component"].replace("_", " "),
            "repair_cost": repair.get("cost_inr", 3000),
            "repair_minutes": repair.get("bay_minutes", 90),
            "breakdown_cost": spec.get("breakdown_cost_inr", 20000),
            "horizon_days": spec.get("horizon_days", 14),
        }
    return out


@lru_cache(maxsize=32)
def _daily_earning(vin: str) -> int:
    """Owner's stated daily income, for the LOSS_FRAME strategy. Only the
    commercial personas declare one; 0 means 'skip the earnings framing'."""
    doc = yaml.safe_load(VEHICLES_YAML.read_text(encoding="utf-8"))
    spec = next((s for s in doc.get("vehicles", []) if s["vin"] == vin), None)
    return int(((spec or {}).get("customer") or {}).get("daily_earning_inr") or 0)


def _route_label(vehicle: dict | None) -> str:
    return DRIVE_CYCLE_LABEL.get((vehicle or {}).get("drive_cycle"), "usual route")


def has_daily_earning(vin: str) -> bool:
    """Whether LOSS_FRAME applies. Only commercial owners (taxi, delivery,
    fleet) declare daily income; framing lost earnings at a weekend driver
    is both meaningless and slightly insulting."""
    return _daily_earning(vin) > 0


async def build_context(vin: str, diagnosis: dict[str, Any], extra: dict | None = None) -> dict:
    vehicle = await asyncio.to_thread(vehicle_info, vin)
    customer = await asyncio.to_thread(customer_for_vin, vin)

    top = diagnosis.get("top") or {}
    component = top.get("component", "the component")
    econ = _component_economics().get(component, {
        "label": str(component).replace("_", " "), "repair_cost": 3000,
        "repair_minutes": 90, "breakdown_cost": 20000, "horizon_days": 14,
    })

    # How long the drift has been visible = the wear already elapsed. M2 gives
    # normalized progress; multiplying by the component's horizon turns it into
    # the "over the last N days..." the EVIDENCE strategy needs.
    progress = top.get("wear_progress")
    if progress is None and top.get("days_to_failure") is not None:
        progress = max(0.0, 1.0 - top["days_to_failure"] / econ["horizon_days"])
    days_observed = max(1, round(econ["horizon_days"] * (progress or 0.0)))

    signal_entry = COMPONENT_SIGNAL.get(component, ("the readings", None, "", "up"))
    signal_label, direction = signal_entry[0], signal_entry[3]
    earning = _daily_earning(vin)

    ctx = {
        "customer_name": (customer or {}).get("name", "there"),
        "model": (vehicle or {}).get("model", "vehicle"),
        "vin": vin,
        "route": _route_label(vehicle),
        "days_observed": days_observed,
        "signal": signal_label,
        "trend": "climbing" if direction == "up" else "dropping",
        "reading": (extra or {}).get("reading", "an abnormal level"),
        "component_label": econ["label"],
        "breakdown_cost": f"{econ['breakdown_cost']:,}",
        "repair_cost": f"{econ['repair_cost']:,}",
        "repair_minutes": econ["repair_minutes"],
        "daily_loss": f"{earning:,}" if earning else "",
        "slot_day": (extra or {}).get("slot_day", "the earliest available day"),
        "slot_time": (extra or {}).get("slot_time", ""),
        "center_name": (extra or {}).get("center_name", "your nearest service centre"),
    }
    if extra:
        ctx.update({k: v for k, v in extra.items() if v})
    return ctx


def latest_reading(telemetry_window: list[dict], component: str) -> str | None:
    """Worst genuine reading of the signal this component's evidence rests on.

    Uses the max (or min, for signals that fall as the part wears) across
    engine-running rows only — the value the owner is actually being warned
    about, rather than whatever the last sampled row happened to be.
    """
    entry = COMPONENT_SIGNAL.get(component)
    if not entry or not telemetry_window:
        return None
    _, field, unit, direction = entry

    values = [
        float(row[field]) for row in telemetry_window
        if row.get(field) is not None
        and (row.get("engine_rpm") or 0) >= ENGINE_RUNNING_RPM
    ]
    if not values:
        return None
    worst = max(values) if direction == "up" else min(values)
    return f"{worst:.1f}{unit}"


async def next_turn(strategy: str, vin: str, diagnosis: dict[str, Any],
                     extra: dict | None = None) -> dict:
    ctx = await build_context(vin, diagnosis, extra)
    system = (
        "You are a persuasive but honest Indian OEM service advisor calling a vehicle "
        "owner. Speak in one short, warm sentence following the given strategy. "
        "Never invent numbers not given to you."
    )
    prompt = f"Strategy: {strategy}\nContext: {ctx}\nSay the next line of the call."
    text, source = await complete(prompt, system=system, fixture_key=f"persuade.{strategy}",
                                   fixture_vars=ctx)
    return {"strategy": strategy, "text": text, "source": source}
