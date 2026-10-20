"""
Booking integrity: one vehicle, at most one upcoming appointment.

Found in the demo database: one Thar Roxx held five live bookings at the same
centre on the same morning — two pairs of them for the very same hour — because
every chat run that ended in "yes" held and confirmed a fresh slot without
asking whether the vehicle was already booked. Each of those rows also took a
bay away from another customer.

The rule lives in app/db/scheduling.py because every booking path (the chat,
the agent graph, and later the car screen) goes through scheduler.hold there.
"""

from __future__ import annotations

import datetime as dt
import time
from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text

from app.db.scheduling import cancel_appointment, confirm_appointment, hold_slot
from app.db.session import engine

MULTI_BAY = "SC-MUM-01"      # three bays per hour in vehicles.yaml
VIN_A, VIN_B = "MH12AB1002", "TN09ZZ1010"


@pytest.fixture(autouse=True)
def _clean_bookings():
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM appointments WHERE vin IN (:a, :b)"), {"a": VIN_A, "b": VIN_B})
        c.execute(text("UPDATE capacity_slots SET status = 'open' "
                       "WHERE center_id = :c AND slot_start > now()"), {"c": MULTI_BAY})


def _future_times(n: int) -> list[str]:
    """`n` distinct upcoming slot times at the multi-bay centre, with every bay open."""
    with engine.connect() as c:
        rows = c.execute(text(
            "SELECT slot_start FROM capacity_slots WHERE center_id = :c AND slot_start > now() "
            "GROUP BY slot_start HAVING bool_and(status = 'open') ORDER BY slot_start LIMIT :n"),
            {"c": MULTI_BAY, "n": n}).scalars().all()
    assert len(rows) == n, "the test database has no open capacity to book against"
    return [r.isoformat() for r in rows]


def _book(vin: str, when: str) -> dict:
    held = hold_slot(MULTI_BAY, when, vin)
    assert held["held"], held
    return confirm_appointment(vin, MULTI_BAY, when, "scheduling_agent", "test-run")


def _active(vin: str) -> list:
    with engine.connect() as c:
        return c.execute(text(
            "SELECT id, slot_start, status FROM appointments "
            "WHERE vin = :v AND status IN ('held', 'booked') AND slot_start > now()"),
            {"v": vin}).all()


def _open_bays(when: str) -> int:
    with engine.connect() as c:
        return c.execute(text(
            "SELECT count(*) FROM capacity_slots "
            "WHERE center_id = :c AND slot_start = :t AND status = 'open'"),
            {"c": MULTI_BAY, "t": dt.datetime.fromisoformat(when)}).scalar()


# ── one upcoming booking per vehicle ───────────────────────────────────────

def test_a_booked_vehicle_cannot_hold_another_slot():
    first, second = _future_times(2)
    booked = _book(VIN_A, first)
    assert booked["booked"]

    again = hold_slot(MULTI_BAY, second, VIN_A)

    assert again["held"] is False
    assert again["existing"]["appointment_id"] == booked["appointment_id"]
    assert len(_active(VIN_A)) == 1


def test_the_same_hour_is_not_booked_twice_for_one_vehicle():
    # The exact duplicate seen in the demo data: a second bay at the same time.
    (when,) = _future_times(1)
    _book(VIN_A, when)

    again = hold_slot(MULTI_BAY, when, VIN_A)

    assert again["held"] is False
    assert len(_active(VIN_A)) == 1


def test_the_refusal_says_which_booking_already_exists():
    (when,) = _future_times(1)
    _book(VIN_A, when)

    existing = hold_slot(MULTI_BAY, when, VIN_A)["existing"]

    assert existing["center_id"] == MULTI_BAY
    assert existing["center_name"]
    assert dt.datetime.fromisoformat(existing["slot_start"]) == dt.datetime.fromisoformat(when)


def test_a_refused_hold_takes_no_bay():
    first, second = _future_times(2)
    _book(VIN_A, first)
    before = _open_bays(second)

    hold_slot(MULTI_BAY, second, VIN_A)

    assert _open_bays(second) == before


def test_a_new_hold_replaces_an_unconfirmed_one_and_frees_its_bay():
    # The owner said yes to one slot and then picked another before it was
    # confirmed: the first hold must not keep a bay locked up.
    first, second = _future_times(2)
    bays_at_first = _open_bays(first)
    assert hold_slot(MULTI_BAY, first, VIN_A)["held"]

    assert hold_slot(MULTI_BAY, second, VIN_A)["held"]

    active = _active(VIN_A)
    assert len(active) == 1
    assert active[0].slot_start == dt.datetime.fromisoformat(second)
    assert _open_bays(first) == bays_at_first


def test_confirming_a_replaced_hold_books_nothing():
    first, second = _future_times(2)
    hold_slot(MULTI_BAY, first, VIN_A)
    hold_slot(MULTI_BAY, second, VIN_A)

    late = confirm_appointment(VIN_A, MULTI_BAY, first, "scheduling_agent", "stale-run")

    assert late["booked"] is False
    assert len(_active(VIN_A)) == 1


def test_a_booking_in_the_past_does_not_block_a_new_one():
    # A missed appointment is history, not an upcoming booking.
    (when,) = _future_times(1)
    with engine.begin() as c:
        c.execute(text(
            "INSERT INTO appointments (id, vin, center_id, slot_start, status) "
            "VALUES ('APT-pasttest01', :v, :c, now() - interval '3 days', 'booked')"),
            {"v": VIN_A, "c": MULTI_BAY})

    assert _book(VIN_A, when)["booked"]


def test_another_vehicle_can_take_another_bay_at_the_same_time():
    (when,) = _future_times(1)
    assert _book(VIN_A, when)["booked"]
    assert _book(VIN_B, when)["booked"]


def test_a_cancelled_booking_can_be_replaced():
    first, second = _future_times(2)
    booked = _book(VIN_A, first)
    cancel_appointment(booked["appointment_id"], "owner changed plans")

    assert _book(VIN_A, second)["booked"]


def test_cancelling_frees_the_bay_it_held():
    (when,) = _future_times(1)
    booked = _book(VIN_A, when)
    before = _open_bays(when)

    cancel_appointment(booked["appointment_id"], "owner changed plans")

    assert _open_bays(when) == before + 1


def test_cancelling_twice_does_not_free_someone_elses_bay():
    (when,) = _future_times(1)
    mine = _book(VIN_A, when)
    _book(VIN_B, when)
    cancel_appointment(mine["appointment_id"], "owner changed plans")
    open_after_first = _open_bays(when)

    cancel_appointment(mine["appointment_id"], "duplicate request")

    assert _open_bays(when) == open_after_first


def test_bookings_for_one_vehicle_wait_for_each_other():
    # Two chat sessions for the same car saying "yes" at the same moment. Racing
    # two threads does not reliably hit the window (the first version of this
    # test passed with the lock removed), so hold the vehicle's lock here — as a
    # concurrent booking would — and check that a second booking waits for it
    # instead of reading a state that is about to change.
    (when,) = _future_times(1)
    with engine.connect() as conn, ThreadPoolExecutor(max_workers=1) as pool:
        tx = conn.begin()
        # NO KEY UPDATE, not UPDATE: inserting the appointment takes a foreign-key
        # share lock on this row, which FOR UPDATE would block on its own — the
        # test passed with the booking lock removed until this was changed.
        conn.execute(text("SELECT vin FROM vehicles WHERE vin = :v FOR NO KEY UPDATE"),
                     {"v": VIN_A})
        pending = pool.submit(hold_slot, MULTI_BAY, when, VIN_A)
        try:
            time.sleep(0.5)
            waited = not pending.done()
        finally:
            tx.rollback()
        assert waited, "a booking for the same vehicle did not wait for the one in progress"
        assert pending.result(timeout=10)["held"]
