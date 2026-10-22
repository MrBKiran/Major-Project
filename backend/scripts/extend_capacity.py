"""
Open the coming weeks' service slots on a long-lived demo database.

Seeding opens SLOT_DAYS of slots once, from the day it runs, so a database
seeded weeks ago has a calendar that has run out — and then nothing anywhere
is bookable. This fills in the days each centre is missing. It never touches a
slot that exists, so live bookings stay as they are; running it twice adds
nothing the second time. (reset_demo.py is the heavier tool: it also clears
predictions and appointments.)

Run:  cd backend && python scripts/extend_capacity.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.db.seed import extend_capacity, load_doc  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402


def main() -> None:
    centres = load_doc().get("service_centers", [])
    with SessionLocal() as session:
        n = extend_capacity(session, centres)
        session.commit()
    print(f"[capacity] {n} slots opened across {len(centres)} centres" if n
          else "[capacity] every centre already has the coming weeks open")


if __name__ == "__main__":
    main()
