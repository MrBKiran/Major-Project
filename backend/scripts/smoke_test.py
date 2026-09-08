"""
End-to-end smoke test — no live MQTT stream required.

1. init_db() + seed() the 10 vehicles/6+ centres/DTC catalog/CAPA ground truth.
2. Replay MH12AB1001's actual scripted arc (water_pump_impeller_wear,
   progress_at_t0=0.62 — see simulator/vehicles.yaml) straight into the
   `telemetry` table, bypassing MQTT for test speed/determinism.
3. Run the Master Agent graph for that VIN and compare the prediction against
   vehicles.yaml's own `expected_prediction` (component=water_pump,
   failure_prob≈0.84, days_to_failure≈9, severity=P2) — the screenplay
   doubles as the test oracle.

Run:  cd backend && ../.venv/Scripts/python.exe scripts/smoke_test.py
"""

from __future__ import annotations

import asyncio
import datetime as dt
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "simulator"))

import yaml  # noqa: E402

from app.db.models import Telemetry  # noqa: E402
from app.db.session import SessionLocal, init_db  # noqa: E402
from app.db.seed import seed  # noqa: E402
from app.tools import core  # noqa: F401,E402 — registers every tool
from app.tools.registry import list_tools  # noqa: E402
from app.ueba import guard  # noqa: E402
from app.ueba.policy import engine  # noqa: E402
from replay import VehicleSim  # noqa: E402

VIN = "MH12AB1001"


def seed_telemetry(vin: str, ticks: int = 220) -> None:
    doc = yaml.safe_load((ROOT / "simulator" / "vehicles.yaml").read_text(encoding="utf-8"))
    spec = next(s for s in doc["vehicles"] if s["vin"] == vin)
    v = VehicleSim.build(spec, doc, seed=42)

    dt_sim = 60.0 / float(doc["meta"].get("tick_hz", 1))   # compression=60 for feature parity with training
    rows = [v.tick(dt_sim) for _ in range(ticks)]

    now = dt.datetime.now(dt.timezone.utc)
    with SessionLocal() as session:
        for i, row in enumerate(rows):
            ts = now - dt.timedelta(seconds=(len(rows) - i))
            session.merge(Telemetry(
                ts=ts, vin=vin,
                engine_rpm=row.get("engine_rpm"), coolant_temp=row.get("coolant_temp"),
                lub_oil_pressure=row.get("lub_oil_pressure"), lub_oil_temp=row.get("lub_oil_temp"),
                fuel_pressure=row.get("fuel_pressure"), battery_voltage=row.get("battery_voltage"),
                tyre_pressure=row.get("tyre_pressure"), brake_fluid_pct=row.get("brake_fluid_pct"),
                speed=row.get("speed"), ambient_temp=row.get("ambient_temp"),
                drive_state=row.get("drive_state", "PARKED"), dtc_codes=row.get("dtc_codes") or [],
            ))
        session.commit()
    print(f"[smoke] seeded {ticks} telemetry rows for {vin} "
          f"(progress={rows[-1]['_progress']:.2f}, dtc={rows[-1]['dtc_codes']})")


async def main() -> None:
    init_db()
    seed()

    guard.install()
    engine.reload()
    print(f"[smoke] {len(list_tools())} tools registered, UEBA armed, "
          f"{len(engine.agents)} agents in policy matrix")

    seed_telemetry(VIN)

    from app.graph.master import run_fleet_graph
    final_state = await run_fleet_graph(VIN, trigger="telemetry_alert")

    print("\n=== RESULT ===")
    print(f"halted: {final_state.get('halted')}  reason: {final_state.get('halt_reason')}")
    print(f"health: {final_state.get('health')}")
    print(f"diagnosis top: {(final_state.get('diagnosis') or {}).get('top')}")
    print(f"service_status: {final_state.get('service_status')}")

    doc = yaml.safe_load((ROOT / "simulator" / "vehicles.yaml").read_text(encoding="utf-8"))
    spec = next(s for s in doc["vehicles"] if s["vin"] == VIN)
    expected = spec["arc"]["expected_prediction"]
    print(f"\nexpected (from vehicles.yaml): {expected}")


if __name__ == "__main__":
    asyncio.run(main())
