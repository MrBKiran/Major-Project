"""
AutoSaarthi — seed script.

Populates vehicles / customers / service_centers / dtc_catalog / capa_records
/ maintenance_history straight from simulator/vehicles.yaml — the screenplay
is the single source of truth, so the DB never drifts from the demo script.

Run:  cd backend && python -m app.db.seed
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import yaml
from sqlalchemy import text

from app.db.models import (
    CapacitySlot,
    CapaRecord,
    Customer,
    DtcCatalog,
    MaintenanceHistory,
    ServiceCenter,
    Vehicle,
)
from app.db.session import SessionLocal, init_db

SLOT_DAYS = 21          # how far out to open the booking calendar
SLOT_HOURS = [9, 10, 11, 12, 14, 15, 16, 17]   # skips the lunch hour
# Service centres and customer `pref_time_window`s in vehicles.yaml are Indian
# local time. Slots are stored tz-aware in IST so a 10:00 slot really is 10 AM
# to the owner — storing these as UTC would shift every displayed time by 5h30.
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))

ROOT = Path(__file__).resolve().parents[3]
VEHICLES_YAML = ROOT / "simulator" / "vehicles.yaml"

# DTC descriptions are given as inline comments in vehicles.yaml's `dtc_at`
# blocks; collected here so dtc.lookup has something real to return.
DTC_CATALOG = [
    {"code": "P0128", "description": "Coolant thermostat below regulating temperature",
     "component": "water_pump", "severity": "P3",
     "typical_causes": ["stuck-open thermostat", "low coolant", "failing water pump"]},
    {"code": "P0217", "description": "Engine over-temperature condition",
     "component": "water_pump", "severity": "P1",
     "typical_causes": ["water pump failure", "coolant leak", "radiator blockage"]},
    {"code": "P0562", "description": "System voltage low",
     "component": "battery", "severity": "P3",
     "typical_causes": ["battery sulphation", "failing alternator", "loose terminal"]},
    {"code": "C1201", "description": "Brake pad wear below minimum thickness",
     "component": "brake_pads", "severity": "P2",
     "typical_causes": ["worn friction material", "aggressive braking pattern"]},
    {"code": "P0171", "description": "System too lean (Bank 1)",
     "component": "fuel_injector", "severity": "P3",
     "typical_causes": ["injector fouling", "vacuum leak", "weak fuel pump"]},
    {"code": "P0521", "description": "Engine oil pressure sensor range/performance",
     "component": "oil_pump", "severity": "P2",
     "typical_causes": ["failing oil pump", "sensor fault", "low oil level"]},
    {"code": "P0524", "description": "Engine oil pressure too low",
     "component": "oil_pump", "severity": "P1",
     "typical_causes": ["oil pump relief valve wear", "oil starvation", "worn bearings"]},
]


def load_doc() -> dict:
    return yaml.safe_load(VEHICLES_YAML.read_text(encoding="utf-8"))


def seed_capacity_slots(session, centers: list[dict]) -> int:
    """Open `SLOT_DAYS` of bookable slots per centre, sized off its own
    `daily_capacity` — this is what makes Pune's under-capacity real for the
    demand-forecast story instead of just a comment in vehicles.yaml."""
    today = dt.date.today()
    n = 0
    for c in centers:
        per_hour = max(1, round(c.get("daily_capacity", 12) / len(SLOT_HOURS)))
        for day_offset in range(SLOT_DAYS):
            day = today + dt.timedelta(days=day_offset)
            if day.weekday() == 6:   # centres close Sunday
                continue
            for hour in SLOT_HOURS:
                start = dt.datetime.combine(day, dt.time(hour=hour), tzinfo=IST)
                for _ in range(per_hour):
                    session.add(CapacitySlot(
                        center_id=c["id"], slot_start=start,
                        slot_end=start + dt.timedelta(hours=1), status="open",
                    ))
                    n += 1
    return n


def seed() -> None:
    doc = load_doc()
    init_db()

    with SessionLocal() as session:
        # ── service centres ──────────────────────────────────────────────
        for c in doc.get("service_centers", []):
            session.merge(ServiceCenter(
                id=c["id"], name=c["name"], city=c["city"],
                lat=c.get("lat"), lng=c.get("lng"),
                bays=c.get("bays", 4), daily_capacity=c.get("daily_capacity", 12),
                skills=c.get("skills"),
            ))

        # ── DTC catalog ───────────────────────────────────────────────────
        for d in DTC_CATALOG:
            session.merge(DtcCatalog(**d))

        # ── capacity slots — random-PK rows, so guard re-seeding explicitly ─
        session.flush()
        existing_slots = session.execute(text("SELECT COUNT(*) FROM capacity_slots")).scalar()
        n_slots = 0
        if not existing_slots:
            n_slots = seed_capacity_slots(session, doc.get("service_centers", []))

        # ── vehicles + customers + history ──────────────────────────────
        for spec in doc.get("vehicles", []):
            cust = spec.get("customer") or {}
            cust_id = f"CUST-{spec['vin']}"
            session.merge(Customer(
                id=cust_id,
                name=cust.get("name", "Unknown"),
                phone=cust.get("phone"),
                email=cust.get("email"),
                language=cust.get("language", "english"),
                pref_time_window=cust.get("pref_time_window"),
                pref_day_preference=cust.get("pref_day_preference"),
                pref_center_id=cust.get("pref_center_id"),
                consent_voice=bool(cust.get("consent_voice", True)),
            ))

            mfg_date = spec.get("mfg_date")
            if isinstance(mfg_date, str):
                mfg_date = dt.date.fromisoformat(mfg_date)

            session.merge(Vehicle(
                vin=spec["vin"], model=spec.get("model", "Unknown"),
                variant=spec.get("variant"), oem=spec.get("oem"),
                mfg_date=mfg_date, batch_id=spec.get("batch_id"),
                plant=spec.get("plant"), owner_id=cust_id,
                odometer=spec.get("odometer_km", 0), city=spec.get("city"),
                drive_cycle=spec.get("drive_cycle"),
            ))

            for i, h in enumerate(spec.get("seed_history") or []):
                session.merge(MaintenanceHistory(
                    id=f"MH-{spec['vin']}-{i}",
                    vin=spec["vin"],
                    date=dt.date.fromisoformat(h["date"]) if isinstance(h["date"], str) else h["date"],
                    service_type=h.get("type", "periodic_service"),
                    cost=h.get("cost_inr"),
                    km_at_service=h.get("km"),
                ))

        # ── CAPA ground truth — the record RCA is supposed to rediscover ──
        gtc = doc.get("ground_truth_cluster") or {}
        if gtc.get("matching_capa"):
            session.merge(CapaRecord(
                capa_id=gtc["matching_capa"],
                defect_mode="Water pump impeller seal degradation → coolant flow loss → overheat",
                component="water_pump",
                batch_id=gtc.get("affected_batch"),
                plant="Nashik",
                root_cause=gtc.get("true_root_cause", "").strip(),
                corrective_action=gtc.get("recommended_corrective"),
                preventive_action=(gtc.get("recommended_preventive") or "").strip(),
                status="closed",
            ))

        session.commit()

    n_vehicles = len(doc.get("vehicles", []))
    n_centers = len(doc.get("service_centers", []))
    slot_msg = f"{n_slots} capacity slots opened" if n_slots else "capacity slots already present"
    print(f"[seed] {n_vehicles} vehicles, {n_centers} service centres, "
          f"{len(DTC_CATALOG)} DTCs, {slot_msg}, CAPA ground truth loaded.")


if __name__ == "__main__":
    seed()
