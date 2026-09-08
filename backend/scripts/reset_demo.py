"""
Reset the system to the exact state the slides were built from.

Run this before every rehearsal and before the real demo. Two reasons it
matters:

  * The feedback loop is real. When a service completes, the Feedback Agent
    writes the replacement into maintenance_history, which the defect
    clustering then counts — so the Slide 4 lift figure genuinely moves as the
    demo runs. That is the loop working, but it means "the number on the slide"
    is only reproducible from a known starting point.
  * Predictions, appointments and held slots accumulate across runs.

Run:  cd backend && python scripts/reset_demo.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import text  # noqa: E402

from app.db.session import SessionLocal, init_db  # noqa: E402

PY = sys.executable

# Transient state produced by running the demo. Order matters: children first.
TRANSIENT_TABLES = [
    "feedback", "service_jobs", "appointments", "predictions", "agent_runs",
]


def clear_transient() -> None:
    with SessionLocal() as session:
        for table in TRANSIENT_TABLES:
            session.execute(text(f"DELETE FROM {table}"))
        # Free every slot the demo held or booked.
        session.execute(text("UPDATE capacity_slots SET status = 'open' "
                              "WHERE status IN ('held', 'booked')"))
        # Drop service records the Feedback Agent wrote back, so the defect
        # cluster returns to its documented baseline. Generated history (HX*)
        # and the yaml-seeded rows (MH-<vin>-<n>) are left untouched.
        session.execute(text(
            "DELETE FROM maintenance_history "
            "WHERE technician_notes LIKE 'Predictive service completed%'"
        ))
        session.commit()
    print(f"[reset] cleared {', '.join(TRANSIENT_TABLES)}; slots reopened; "
          "agent-written service records removed")


def main() -> None:
    init_db()
    clear_transient()
    subprocess.run([PY, str(ROOT / "backend" / "scripts" / "seed_telemetry.py")], check=True)
    print("[reset] demo state restored — run the sweep to repopulate predictions")


if __name__ == "__main__":
    main()
