"""
Extending service capacity past what was seeded.

Seeding opens SLOT_DAYS of slots once, from the day it runs; after that the
demo calendar simply ran out (the demo database's last slot was 12 Sep) and
nothing anywhere was bookable. `extend_capacity` adds the days a centre does
not have yet — and never touches a slot that exists, so a booking stays booked.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import text

from app.db.models import CapacitySlot
from app.db.seed import SLOT_DAYS, SLOT_HOURS, extend_capacity
from app.db.session import SessionLocal, engine

# The calendar is Indian time (app/db/seed.py), whatever the machine's zone.
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
CENTRE = {"id": "SC-TST-01", "name": "Test Centre", "city": "Testpur", "daily_capacity": 8}


@pytest.fixture(autouse=True)
def centre():
    with engine.begin() as c:
        c.execute(text("INSERT INTO service_centers (id, name, city, bays, daily_capacity) "
                       "VALUES (:id, :name, :city, 2, :cap) ON CONFLICT (id) DO NOTHING"),
                  {"id": CENTRE["id"], "name": CENTRE["name"], "city": CENTRE["city"], "cap": CENTRE["daily_capacity"]})
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM capacity_slots WHERE center_id = :c"), {"c": CENTRE["id"]})
        c.execute(text("DELETE FROM service_centers WHERE id = :c"), {"c": CENTRE["id"]})


def extend() -> int:
    with SessionLocal() as session:
        n = extend_capacity(session, [CENTRE])
        session.commit()
    return n


def slots(where: str = "TRUE", **params) -> list:
    with engine.connect() as c:
        return c.execute(text(f"SELECT slot_start, status FROM capacity_slots WHERE center_id = :c AND {where} "
                              "ORDER BY slot_start"), {"c": CENTRE["id"], **params}).all()


def add_slot(start: dt.datetime, status: str = "open") -> None:
    with SessionLocal() as session:
        session.add(CapacitySlot(center_id=CENTRE["id"], slot_start=start,
                                 slot_end=start + dt.timedelta(hours=1), status=status))
        session.commit()


def test_a_centre_whose_calendar_ran_out_gets_the_coming_days():
    add_slot(dt.datetime(2026, 9, 12, 11, 0, tzinfo=dt.timezone.utc))          # all in the past
    assert extend() > 0
    # From the start of today, not from now: after 17:00 every one of today's
    # slots is already past, and counting from now dropped today.
    today = dt.datetime.now(IST).date()
    opened = slots("slot_start >= :since", since=dt.datetime.combine(today, dt.time(), tzinfo=IST))
    days = {s.slot_start.astimezone(IST).date() for s in opened}
    expected = {today + dt.timedelta(days=d) for d in range(SLOT_DAYS)}
    assert days == {d for d in expected if d.weekday() != 6}                      # closed on Sundays


def test_each_open_day_gets_the_seeded_hours():
    extend()
    per_hour = max(1, round(CENTRE["daily_capacity"] / len(SLOT_HOURS)))
    tomorrow = dt.datetime.now(IST).date() + dt.timedelta(days=1)
    if tomorrow.weekday() == 6:
        tomorrow += dt.timedelta(days=1)
    with engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM capacity_slots WHERE center_id = :c "
                           "AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = :d"),
                      {"c": CENTRE["id"], "d": tomorrow}).scalar()
    assert n == per_hour * len(SLOT_HOURS)


def test_running_it_again_adds_nothing():
    extend()
    before = len(slots())
    assert extend() == 0
    assert len(slots()) == before


def test_a_day_that_already_has_slots_is_left_as_it_is():
    # Booked bays must stay booked; the day is not topped up or reopened.
    tomorrow = dt.datetime.now(IST).date() + dt.timedelta(days=1)
    if tomorrow.weekday() == 6:
        tomorrow += dt.timedelta(days=1)
    add_slot(dt.datetime.combine(tomorrow, dt.time(10), tzinfo=IST), status="booked")
    extend()
    with engine.connect() as c:
        rows = c.execute(text("SELECT status FROM capacity_slots WHERE center_id = :c "
                              "AND (slot_start AT TIME ZONE 'Asia/Kolkata')::date = :d"),
                         {"c": CENTRE["id"], "d": tomorrow}).scalars().all()
    assert rows == ["booked"]
