"""
Historical daily service demand per centre — the series M3 forecasts.

Shaped to make Slide 2's story true rather than asserted: Pune is deliberately
run close to capacity (vehicles.yaml calls the network "deliberately
under-capacity in Pune"), so the forecast surfaces a real overload rather than
a decorative one.

Signal composition, all of which SARIMAX has to disentangle:
  * a per-centre base level scaled off daily_capacity
  * weekly seasonality — Monday and Saturday peak, Sunday closed
  * a mild upward trend (the parc grows)
  * month-end spikes (fleet operators service before month close)
  * Poisson-ish noise

Run:  cd backend && python -m app.db.demand_seed
"""

from __future__ import annotations

import datetime as dt
import math
import random

from sqlalchemy import text

from app.db.models import ServiceCenter, ServiceDemandDaily
from app.db.session import SessionLocal, init_db

SEED = 909
HISTORY_DAYS = 240

# Multiplier by weekday (Mon=0). Sunday is closed; Monday and Saturday are the
# real-world peaks for Indian service centres.
WEEKDAY_FACTOR = [1.25, 1.0, 0.95, 0.95, 1.05, 1.30, 0.0]

# Centres already at the edge — utilisation high enough that a forecast bump
# tips them over. Pune is the demo's bottleneck.
STRESSED_CENTRES = {"SC-PUN-01": 0.93, "SC-PUN-02": 0.88}
DEFAULT_UTILISATION = 0.62


def generate(session, rng: random.Random) -> int:
    centres = session.query(ServiceCenter).all()
    today = dt.date.today()
    rows = 0

    for c in centres:
        utilisation = STRESSED_CENTRES.get(c.id, DEFAULT_UTILISATION)
        base = c.daily_capacity * utilisation

        for d in range(HISTORY_DAYS, 0, -1):
            day = today - dt.timedelta(days=d)
            factor = WEEKDAY_FACTOR[day.weekday()]
            if factor == 0.0:
                jobs = 0
            else:
                trend = 1.0 + 0.12 * (HISTORY_DAYS - d) / HISTORY_DAYS
                month_end = 1.18 if day.day >= 27 else 1.0
                seasonal = 1.0 + 0.05 * math.sin(2 * math.pi * day.timetuple().tm_yday / 365)
                mean = base * factor * trend * month_end * seasonal
                jobs = max(0, int(rng.gauss(mean, max(1.0, mean * 0.15))))
                jobs = min(jobs, c.daily_capacity)      # cannot exceed bay capacity
            session.merge(ServiceDemandDaily(center_id=c.id, date=day, jobs=jobs))
            rows += 1
    return rows


def seed_demand(force: bool = False) -> None:
    init_db()
    rng = random.Random(SEED)
    with SessionLocal() as session:
        existing = session.execute(text("SELECT COUNT(*) FROM service_demand_daily")).scalar()
        if existing and not force:
            print(f"[demand] {existing} rows already present — skipping.")
            return
        if force and existing:
            session.execute(text("DELETE FROM service_demand_daily"))
            session.flush()
        n = generate(session, rng)
        session.commit()
    print(f"[demand] {n} centre-day demand rows generated over {HISTORY_DAYS} days.")


if __name__ == "__main__":
    import sys
    seed_demand(force="--force" in sys.argv)
