"""
AutoSaarthi — historical fleet + maintenance records ("Maintenance Records
Server" from the problem statement).

The 10 vehicles in simulator/vehicles.yaml are the *instrumented* fleet whose
telemetry streams live. Defect clustering needs a far larger parc to have any
statistical meaning, so this generates a realistic service history across ~500
vehicles spanning several manufacturing batches.

The point is that BATCH-2024-Q3-WP carries a genuinely elevated water-pump
replacement rate, buried among ordinary wear-and-tear across every other batch.
The Manufacturing Quality agent has to *rediscover* it from the data — the
answer lives in vehicles.yaml's `ground_truth_cluster`, which nothing in the
RCA path is allowed to read.

Run:  cd backend && python -m app.db.history_seed
"""

from __future__ import annotations

import datetime as dt
import random

from sqlalchemy import text

from app.db.models import MaintenanceHistory, Vehicle
from app.db.seed import load_doc
from app.db.session import SessionLocal, init_db

SEED = 4242

# Marks generated historical vehicles so --force can find them again. Must not
# collide with any real VIN pattern, and must stay stable — a prefix that
# drifts leaves orphaned rows that quietly skew the defect statistics.
HIST_PREFIX = "HX"

# The defective lot, straight from vehicles.yaml's ground_truth_cluster.
DEFECT_BATCH = "BATCH-2024-Q3-WP"
DEFECT_BATCH_SIZE = 40
# 7, per PROJECT_PLAN §13's slide spec ("7/40 vehicles"). vehicles.yaml's
# ground_truth_cluster says 5 with an 8.0% rate, but 5/40 is 12.5%, not 8.0% —
# those two numbers were never consistent with each other. 7 is also the level
# at which the cluster survives multiple-comparison correction: at 5 the signal
# is real but too weak to defend once ~45 cohorts have been screened.
DEFECT_BATCH_FAILURES = 7          # water-pump replacements within that lot

# Baseline replacement rates across the rest of the parc, by component. These
# are ordinary wear: brakes go often, oil pumps almost never.
BASELINE_RATES = {
    "water_pump": 0.021,           # the fleet baseline the batch is compared against
    "brake_pads": 0.150,
    "battery": 0.080,
    "fuel_injector": 0.040,
    "oil_pump": 0.015,
}

# (batch_id, oem, plant, size). Brand and plant are properties of the BATCH,
# not of individual vehicles: a production lot is built by one manufacturer at
# one plant. Assigning oem per-vehicle produced brand-mixed batches, which made
# every batch split arbitrarily once quality analysis became brand-scoped —
# each OEM saw a slice of a rival's lot and only part of its own.
OTHER_BATCHES = [
    ("BATCH-2024-Q1-STD", "Mahindra", "Nashik", 60),
    ("BATCH-2024-Q2-STD", "Mahindra", "Nashik", 55),
    ("BATCH-2024-Q4-STD", "Mahindra", "Nashik", 50),
    ("BATCH-2025-Q1-STD", "Mahindra", "Chakan", 65),
    ("BATCH-2023-Q2-STD", "Mahindra", "Chakan", 45),
    ("BATCH-2023-Q4-STD", "Mahindra", "Chakan", 50),
    ("BATCH-2024-Q3-STD", "Mahindra", "Chakan", 58),
    ("BATCH-2025-Q2-HRO", "Hero", "Haridwar", 47),
    ("BATCH-2023-Q3-HRO", "Hero", "Dharuhera", 40),
]

# Models are brand-specific. A Hero Splendor is an air-cooled motorcycle and
# has no water pump at all, so letting it appear in a water-pump cohort would
# be a domain error, not just a labelling one.
BRAND_MODELS = {
    "Mahindra": ["Bolero", "Scorpio Classic", "XUV700", "Thar", "XUV300",
                  "Bolero Neo", "Scorpio-N", "Bolero Pik-Up"],
    "Hero": ["Splendor Plus", "Passion Pro", "Glamour", "HF Deluxe", "Xtreme 125R"],
}

# Components a brand's vehicles can actually fail. Motorcycles have no water
# pump or brake-pad-set-front in the same sense; keeping this honest stops the
# clustering from inventing cohorts that could not physically exist.
BRAND_COMPONENTS = {
    "Mahindra": ["water_pump", "brake_pads", "battery", "fuel_injector", "oil_pump"],
    "Hero": ["brake_pads", "battery", "fuel_injector"],
}
CITIES = ["Pune", "Mumbai", "Delhi", "Bengaluru", "Chennai", "Hyderabad",
          "Jaipur", "Meerut", "Rajkot", "Nagpur", "Indore", "Lucknow"]

SERVICE_TYPES = ["periodic_service", "running_repair", "component_replacement"]

COMPONENT_PARTS = {
    "water_pump": ["water_pump_assy", "coolant_5l"],
    "brake_pads": ["brake_pad_set_front"],
    "battery": ["battery_12v_65ah"],
    "fuel_injector": ["injector_set", "fuel_filter"],
    "oil_pump": ["oil_pump", "oil_5w30_4l"],
}
COMPONENT_COST = {
    "water_pump": 2400, "brake_pads": 3100, "battery": 5200,
    "fuel_injector": 4600, "oil_pump": 7800,
}
TECH_NOTES = {
    "water_pump": [
        "Coolant weep at pump bearing housing. Impeller shaft play beyond limit.",
        "Overheating complaint. Pump seal seeping, replaced assembly and flushed system.",
        "Customer reported temperature gauge climbing on highway. Water pump replaced.",
    ],
    "brake_pads": [
        "Front pads below 3mm. Rotors within limit, pads replaced.",
        "Brake squeal reported. Friction material worn, pad set replaced.",
    ],
    "battery": ["Cranking voltage low. Battery failed load test, replaced.",
                 "Vehicle not starting after overnight park. Battery sulphated."],
    "fuel_injector": ["Rough idle and misfire. Injectors cleaned/replaced, filter changed.",
                       "Lean code stored. Injector spray pattern out of spec."],
    "oil_pump": ["Low oil pressure warning. Pump relief valve worn, assembly replaced.",
                  "Oil pressure below spec at hot idle. Pump replaced."],
}


def _batch_plan(rng: random.Random) -> list[tuple[str, str, str, int]]:
    # The defective lot is Mahindra/Nashik — that is where the demo's hero
    # vehicle (MH12AB1001, a Bolero) was built.
    return [(DEFECT_BATCH, "Mahindra", "Nashik", DEFECT_BATCH_SIZE), *OTHER_BATCHES]


def _mfg_date_for(batch_id: str, rng: random.Random) -> dt.date:
    """Batch ids encode YYYY-Qn; place the build date inside that quarter."""
    try:
        parts = batch_id.split("-")
        year, quarter = int(parts[1]), int(parts[2][1])
    except (IndexError, ValueError):
        year, quarter = 2024, 1
    start_month = 3 * (quarter - 1) + 1
    return dt.date(year, start_month, 1) + dt.timedelta(days=rng.randint(0, 80))


def generate(session, rng: random.Random) -> tuple[int, int]:
    doc = load_doc()
    demo_vins = {v["vin"] for v in doc.get("vehicles", [])}
    centers = [c["id"] for c in doc.get("service_centers", [])]

    n_vehicles = n_records = 0
    today = dt.date.today()
    # maintenance_history.vin is FK -> vehicles.vin, so every vehicle must be
    # inserted before any of its service records. Staged in two phases with an
    # explicit flush between rather than relying on unit-of-work ordering.
    pending_records: list[MaintenanceHistory] = []

    for batch_id, oem, plant, size in _batch_plan(rng):
        is_defect_batch = batch_id == DEFECT_BATCH
        brand_components = BRAND_COMPONENTS[oem]
        # Which vehicles in this lot had a water pump replaced.
        wp_failures = set()
        if "water_pump" in brand_components:
            wp_failures = set(
                rng.sample(range(size), DEFECT_BATCH_FAILURES) if is_defect_batch
                else rng.sample(range(size), round(size * BASELINE_RATES["water_pump"]))
            )

        for i in range(size):
            # Full batch suffix, not a fixed slice: "BATCH-2024-Q3-WP" and
            # "BATCH-2024-Q3-STD" share their first 13 chars, so slicing
            # collided their VINs and merged the defective lot into a healthy
            # one — silently destroying the cluster this data exists to expose.
            code = batch_id.removeprefix("BATCH-").replace("-", "")
            vin = f"{HIST_PREFIX}{code}{i:03d}"
            if vin in demo_vins:
                continue
            mfg_date = _mfg_date_for(batch_id, rng)
            age_days = max(30, (today - mfg_date).days)
            odometer = int(age_days * rng.uniform(25, 110))

            session.merge(Vehicle(
                vin=vin, model=rng.choice(BRAND_MODELS[oem]), oem=oem,
                mfg_date=mfg_date, batch_id=batch_id, plant=plant,
                odometer=odometer, city=rng.choice(CITIES),
            ))
            n_vehicles += 1

            # Which components this vehicle had replaced over its life.
            replaced = {c for c, rate in BASELINE_RATES.items()
                        if c != "water_pump" and c in brand_components
                        and rng.random() < rate}
            if i in wp_failures:
                replaced.add("water_pump")

            # Routine services, plus one visit per component replacement.
            visits: list[tuple[str, str | None]] = [
                ("periodic_service", None) for _ in range(rng.randint(1, 3))
            ]
            visits += [("component_replacement", c) for c in replaced]
            rng.shuffle(visits)

            for j, (service_type, component) in enumerate(visits):
                svc_date = mfg_date + dt.timedelta(days=rng.randint(60, max(90, age_days)))
                if svc_date > today:
                    svc_date = today - dt.timedelta(days=rng.randint(1, 45))
                pending_records.append(MaintenanceHistory(
                    id=f"MH-{vin}-{j}",
                    vin=vin, date=svc_date, service_type=service_type,
                    components_replaced=COMPONENT_PARTS.get(component, []) if component else [],
                    cost=float(COMPONENT_COST.get(component, rng.randint(1800, 3600))),
                    center_id=rng.choice(centers),
                    technician_notes=(rng.choice(TECH_NOTES[component]) if component
                                       else "Scheduled maintenance: oil, filters, general inspection."),
                    km_at_service=int(odometer * rng.uniform(0.3, 0.95)),
                ))
                n_records += 1

    session.flush()                 # all vehicles land before their FK children
    session.add_all(pending_records)
    return n_vehicles, n_records


def seed_history(force: bool = False) -> None:
    init_db()
    rng = random.Random(SEED)
    with SessionLocal() as session:
        params = {"hp": f"{HIST_PREFIX}%"}
        existing = session.execute(
            text("SELECT COUNT(*) FROM vehicles WHERE vin LIKE :hp"), params
        ).scalar()
        if existing and not force:
            print(f"[history] {existing} historical vehicles already present — skipping.")
            return
        if force and existing:
            session.execute(text("DELETE FROM maintenance_history WHERE vin LIKE :hp"), params)
            session.execute(text("DELETE FROM vehicles WHERE vin LIKE :hp"), params)
            session.flush()

        n_v, n_r = generate(session, rng)
        session.commit()
    print(f"[history] {n_v} historical vehicles, {n_r} maintenance records generated.")


if __name__ == "__main__":
    import sys
    seed_history(force="--force" in sys.argv)
