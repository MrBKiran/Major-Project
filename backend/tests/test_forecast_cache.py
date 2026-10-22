"""
The demand forecast fits SARIMAX once per centre and history, not per request.

A fit is most of a forecast's cost (~0.7 s a centre, 7.7 s for the fleet) and
holds the interpreter while it runs. Every request refitted every centre, so two
Service Ops pages open at once took a minute and stalled every other request on
the server — sign-in took 12 s. The fit depends only on the centre's job
history; the predicted-failure load beside it is live and must stay so.
"""

from __future__ import annotations

import datetime as dt
import threading
import time

import pytest
from sqlalchemy import text

from app.db.session import engine
from app.ml import forecast

CENTRE = "SC-FCT-01"
DAYS = 60


def forget_fits():
    getattr(forecast, "_FITS", {}).clear()


def remove_centre():
    with engine.begin() as c:
        c.execute(text("DELETE FROM service_demand_daily WHERE center_id = :c"), {"c": CENTRE})
        c.execute(text("DELETE FROM service_centers WHERE id = :c"), {"c": CENTRE})


@pytest.fixture(autouse=True)
def centre():
    remove_centre()   # a run that died part-way may have left it
    start = dt.date.today() - dt.timedelta(days=DAYS)
    with engine.begin() as c:
        c.execute(text("INSERT INTO service_centers (id, name, city, bays, daily_capacity) "
                       "VALUES (:id, 'Forecast Test', 'Testpur', 2, 10) ON CONFLICT (id) DO NOTHING"),
                  {"id": CENTRE})
        for i in range(DAYS):
            day = start + dt.timedelta(days=i)
            c.execute(text("INSERT INTO service_demand_daily (center_id, date, jobs) VALUES (:c, :d, :j)"),
                      {"c": CENTRE, "d": day, "j": 4 + (i % 7) + (i % 3)})
    forget_fits()
    yield
    forget_fits()
    remove_centre()


@pytest.fixture
def fits(monkeypatch):
    """Counts SARIMAX fits; each takes a little longer, so concurrent calls overlap."""
    real = forecast.SARIMAX
    made: list[int] = []

    def counted(*args, **kwargs):
        made.append(1)
        time.sleep(0.2)
        return real(*args, **kwargs)

    monkeypatch.setattr(forecast, "SARIMAX", counted)
    return made


def test_a_second_forecast_reuses_the_fit(fits):
    first = forecast.forecast_center(CENTRE, 14)
    second = forecast.forecast_center(CENTRE, 14)
    assert len(fits) == 1
    assert second == first


def test_a_changed_history_is_fitted_again(fits):
    forecast.forecast_center(CENTRE, 14)
    with engine.begin() as c:
        c.execute(text("UPDATE service_demand_daily SET jobs = jobs + 5 WHERE center_id = :c "
                       "AND date = (SELECT MAX(date) FROM service_demand_daily WHERE center_id = :c)"),
                  {"c": CENTRE})
    forecast.forecast_center(CENTRE, 14)
    assert len(fits) == 2


def test_another_horizon_is_its_own_fit(fits):
    forecast.forecast_center(CENTRE, 14)
    forecast.forecast_center(CENTRE, 7)
    assert len(fits) == 2


def test_predicted_failures_stay_live(fits, monkeypatch):
    # The page's point is predictions changing which days overload: that part
    # is read fresh on every request, cached fit or not.
    first = forecast.forecast_center(CENTRE, 14)
    day = first["series"][2]["date"]
    monkeypatch.setattr(forecast, "_predicted_failure_load", lambda c, h: {day: 9})
    second = forecast.forecast_center(CENTRE, 14)
    assert len(fits) == 1
    assert next(d for d in second["series"] if d["date"] == day)["predicted_failure_jobs"] == 9
    assert day in second["overloaded_days"]


def test_requests_at_the_same_time_share_one_fit(fits):
    gate = threading.Barrier(3)
    results = []

    def ask():
        gate.wait()
        results.append(forecast.forecast_center(CENTRE, 14))

    workers = [threading.Thread(target=ask) for _ in range(3)]
    for w in workers:
        w.start()
    for w in workers:
        w.join()
    assert len(fits) == 1
    assert results[0] == results[1] == results[2]
