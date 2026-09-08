"""
Seed the telemetry hypertable with every vehicle's scripted arc.

The live path is simulator/replay.py -> MQTT -> app/ingest.py. This writes the
same rows straight to Timescale instead: deterministic, instant, and it does
not require the broker and ingest process to be running. Use it to put the
fleet into a known state before a demo, a forecast, or a test.

Rows are stamped backwards from now at one-second spacing, so the whole window
falls inside the last N minutes that telemetry_window() queries.

Run:  cd backend && python scripts/seed_telemetry.py [--ticks 220]
"""

from __future__ import annotations

import argparse
import datetime as dt
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "simulator"))

import yaml  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.db.models import Telemetry  # noqa: E402
from app.db.session import SessionLocal, init_db  # noqa: E402
from replay import VehicleSim, derive_drive_state  # noqa: E402

# Compression 60 => one tick per simulated minute, matching what the M1/M2
# feature windows were trained on. The demo default of 43200 would put 12
# simulated hours between rows and make rolling features meaningless.
COMPRESSION = 60.0


def seed_vin(session, doc: dict, spec: dict, ticks: int, now: dt.datetime) -> str:
    # Clear this VIN's existing rows first. Without it a second run stacks a
    # new arc on top of the old one inside the same query window, and the
    # rolling features are computed over a blend of two different wear states —
    # which silently produces wrong predictions rather than an obvious error.
    session.execute(
        text("DELETE FROM telemetry WHERE vin = :vin"), {"vin": spec["vin"]},
    )
    v = VehicleSim.build(spec, doc, seed=42)
    dt_sim = COMPRESSION / float(doc["meta"].get("tick_hz", 1))
    rows = [v.tick(dt_sim) for _ in range(ticks)]

    for i, row in enumerate(rows):
        ts = now - dt.timedelta(seconds=(len(rows) - i))
        session.merge(Telemetry(
            ts=ts, vin=spec["vin"],
            engine_rpm=row.get("engine_rpm"), coolant_temp=row.get("coolant_temp"),
            lub_oil_pressure=row.get("lub_oil_pressure"), lub_oil_temp=row.get("lub_oil_temp"),
            fuel_pressure=row.get("fuel_pressure"), battery_voltage=row.get("battery_voltage"),
            tyre_pressure=row.get("tyre_pressure"), brake_fluid_pct=row.get("brake_fluid_pct"),
            speed=row.get("speed"), ambient_temp=row.get("ambient_temp"),
            drive_state=derive_drive_state(row), dtc_codes=row.get("dtc_codes") or [],
        ))
    last = rows[-1]
    return (f"{spec['vin']}  progress={last['_progress']:.2f}  "
            f"arc={last.get('_degradation') or 'healthy'}  dtc={last['dtc_codes'] or '-'}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ticks", type=int, default=220,
                     help="rows per vehicle; must exceed the longest feature window (180)")
    ap.add_argument("--vins", nargs="*", help="subset of VINs (default: all)")
    args = ap.parse_args()

    init_db()
    doc = yaml.safe_load((ROOT / "simulator" / "vehicles.yaml").read_text(encoding="utf-8"))
    specs = doc["vehicles"]
    if args.vins:
        specs = [s for s in specs if s["vin"] in args.vins]

    now = dt.datetime.now(dt.timezone.utc)
    with SessionLocal() as session:
        for spec in specs:
            print("  " + seed_vin(session, doc, spec, args.ticks, now))
        session.commit()
    print(f"[telemetry] seeded {len(specs)} vehicles x {args.ticks} rows")


if __name__ == "__main__":
    main()
