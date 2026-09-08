"""Read helpers used by tools/core.py. Kept separate from models.py so the
tool layer never has to touch SQLAlchemy session/query mechanics directly."""

from __future__ import annotations

import datetime as dt

import pandas as pd
from sqlalchemy import select, text

from app.db.models import Customer, DtcCatalog, MaintenanceHistory, ServiceCenter, Vehicle
from app.db.session import SessionLocal, engine

TELEMETRY_COLUMNS = [
    "ts", "vin", "engine_rpm", "coolant_temp", "lub_oil_pressure", "lub_oil_temp",
    "fuel_pressure", "battery_voltage", "tyre_pressure", "brake_fluid_pct",
    "speed", "ambient_temp", "drive_state", "dtc_codes",
]


def telemetry_window(vin: str, minutes: int) -> pd.DataFrame:
    """Real telemetry rows for `vin` published in the last `minutes` of
    wall-clock time (the simulator stamps `ts` with time.time() at publish,
    so this is a real time filter regardless of the simulated-clock
    compression factor)."""
    since = dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=minutes)
    cols = ", ".join(TELEMETRY_COLUMNS)
    sql = text(f"""
        SELECT {cols} FROM telemetry
        WHERE vin = :vin AND ts >= :since
        ORDER BY ts ASC
    """)
    with engine.connect() as conn:
        df = pd.read_sql(sql, conn, params={"vin": vin, "since": since})
    return df


def maintenance_history(vin: str, limit: int = 20) -> list[dict]:
    with SessionLocal() as session:
        rows = session.execute(
            select(MaintenanceHistory)
            .where(MaintenanceHistory.vin == vin)
            .order_by(MaintenanceHistory.date.desc())
            .limit(limit)
        ).scalars().all()
        return [
            {"date": str(r.date), "service_type": r.service_type, "cost": r.cost,
             "components_replaced": r.components_replaced, "km_at_service": r.km_at_service}
            for r in rows
        ]


def vehicle_info(vin: str) -> dict | None:
    with SessionLocal() as session:
        v = session.get(Vehicle, vin)
        if not v:
            return None
        return {"vin": v.vin, "model": v.model, "batch_id": v.batch_id,
                "plant": v.plant, "odometer": v.odometer, "city": v.city,
                "drive_cycle": v.drive_cycle, "owner_id": v.owner_id}


def customer_for_vin(vin: str) -> dict | None:
    with SessionLocal() as session:
        v = session.get(Vehicle, vin)
        if not v or not v.owner_id:
            return None
        c = session.get(Customer, v.owner_id)
        if not c:
            return None
        return {"customer_id": c.id, "name": c.name, "phone": c.phone, "email": c.email,
                "language": c.language, "pref_time_window": c.pref_time_window,
                "pref_day_preference": c.pref_day_preference,
                "pref_center_id": c.pref_center_id, "consent_voice": c.consent_voice,
                "consent_push": c.consent_push}


def dtc_lookup(code: str) -> dict | None:
    with SessionLocal() as session:
        d = session.get(DtcCatalog, code)
        if not d:
            return None
        return {"code": d.code, "description": d.description, "component": d.component,
                "severity": d.severity, "typical_causes": d.typical_causes}


_ALLOWED_GROUP_COLUMNS = {
    "component": "part.component", "batch_id": "v.batch_id", "plant": "v.plant",
    "model": "v.model", "city": "v.city",
}


def write_predictions(vin: str, predictions: list[dict], model_version: str = "m2-v1") -> dict:
    """Persist the Diagnosis Agent's output.

    Predictions must be durable, not just passed along in run state: the M3
    demand forecast reads them to anticipate the workload the predictive system
    is about to create, and the fleet dashboard reads them to show current risk.
    Superseded rows for the same VIN+component are replaced so the table always
    reflects the latest assessment rather than an append-only pile.
    """
    from app.db.models import Prediction

    written = []
    with SessionLocal() as session:
        # Clear every prior prediction for this VIN, not just the components
        # being rewritten. Deleting per-component left stale rows behind the
        # moment a vehicle stopped being at risk — a repaired or cleared fault
        # would show as active on the dashboard forever, and an empty result
        # (healthy) would clear nothing at all.
        session.execute(text("DELETE FROM predictions WHERE vin = :vin"), {"vin": vin})
        for p in predictions:
            row = Prediction(
                vin=vin, component=p["component"], failure_prob=p["failure_prob"],
                days_to_failure=p.get("days_to_failure"), severity=p.get("severity"),
                model_version=model_version, shap_top=p.get("shap_top"),
            )
            session.add(row)
            written.append(p["component"])
        session.commit()
    return {"written": len(written), "components": written, "vin": vin}


def aggregate_failures(group_by: list[str], since_days: int = 365,
                        min_cohort_size: int = 5) -> list[dict]:
    """Counts of component replacements, grouped by build/geography attributes.

    Deliberately returns no VINs, names, or dates — mfg_quality_agent is
    `aggregate_only` in config/agent_policy.yaml, so this must be incapable of
    leaking row-level identity even if asked. Group keys are whitelisted rather
    than interpolated, and cohorts below `min_cohort_size` are dropped for
    k-anonymity.
    """
    cols = [c for c in group_by if c in _ALLOWED_GROUP_COLUMNS]
    if not cols:
        cols = ["component", "batch_id"]
    select_expr = ", ".join(f"{_ALLOWED_GROUP_COLUMNS[c]} AS {c}" for c in cols)
    group_expr = ", ".join(_ALLOWED_GROUP_COLUMNS[c] for c in cols)

    sql = text(f"""
        WITH part AS (
            SELECT m.vin, m.date,
                   CASE
                     WHEN 'water_pump_assy' = ANY(m.components_replaced) THEN 'water_pump'
                     WHEN 'brake_pad_set_front' = ANY(m.components_replaced) THEN 'brake_pads'
                     WHEN 'battery_12v_65ah' = ANY(m.components_replaced) THEN 'battery'
                     WHEN 'injector_set' = ANY(m.components_replaced) THEN 'fuel_injector'
                     WHEN 'oil_pump' = ANY(m.components_replaced) THEN 'oil_pump'
                   END AS component
            FROM maintenance_history m
            WHERE m.date >= CURRENT_DATE - make_interval(days => :since_days)
        )
        SELECT {select_expr}, COUNT(DISTINCT part.vin) AS failures
        FROM part JOIN vehicles v ON v.vin = part.vin
        WHERE part.component IS NOT NULL
        GROUP BY {group_expr}
        HAVING COUNT(DISTINCT part.vin) >= :min_cohort
        ORDER BY failures DESC
        LIMIT 100
    """)
    with engine.connect() as conn:
        rows = conn.execute(sql, {"since_days": since_days, "min_cohort": min_cohort_size}).all()
    return [dict(zip([*cols, "failures"], r)) for r in rows]


def service_center(center_id: str) -> dict | None:
    with SessionLocal() as session:
        c = session.get(ServiceCenter, center_id)
        if not c:
            return None
        # lat/lng are selected because maps.eta computes a real distance from
        # them; they were on the model but never returned, so every caller saw
        # a centre with no location.
        return {"id": c.id, "name": c.name, "city": c.city, "bays": c.bays,
                "daily_capacity": c.daily_capacity, "skills": c.skills,
                "lat": c.lat, "lng": c.lng}
