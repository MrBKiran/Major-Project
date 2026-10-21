"""
Booking from the phone (Phase 4): the owner books, moves or cancels their own
car's service directly, not only by talking to the agent.

Unlike the car screen (tests/test_car.py) this is not gated on drive state: the
phone is not the car's display, and an owner at home has a car whose last
reading is old. What it shares with every other path is the scheduling layer's
rule of one upcoming booking per vehicle, and moving a booking is one
transaction — the owner never ends up with two bookings, or with none because
the new slot was taken while the old one was being released.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db.session import engine

from .auth.helpers import bearer, make_user, token_for

VIN = "MH12AB1001"          # Ramesh's car, in Pune
CITY = "Pune"
OWNER = "ramesh.pawar@example.in"


@pytest.fixture(autouse=True)
def _clean():
    yield
    with engine.begin() as c:
        for table in ("telemetry", "predictions", "appointments"):
            c.execute(text(f"DELETE FROM {table} WHERE vin = :v"), {"v": VIN})
        c.execute(text("UPDATE capacity_slots SET status = 'open' WHERE slot_start > now() "
                       "AND center_id IN (SELECT id FROM service_centers WHERE city = :c)"), {"c": CITY})


@pytest.fixture
def owner(client):
    return token_for(client, OWNER)


def predict(component="battery", severity="P2", days=6.0):
    with engine.begin() as c:
        c.execute(text("INSERT INTO predictions (id, vin, ts, component, failure_prob, days_to_failure, "
                       "severity, model_version) VALUES (:id, :v, now(), :c, 0.9, :d, :s, 'test')"),
                  {"id": f"PRD-{component[:8]}", "v": VIN, "c": component, "d": days, "s": severity})


def view(client, tok, vin=VIN):
    r = client.get(f"/api/vehicles/{vin}/service", headers=bearer(tok))
    assert r.status_code == 200, r.text
    return r.json()


def post(client, tok, action, slot=None, vin=VIN):
    body = {"center_id": slot["center_id"], "slot_start": slot["slot_start"]} if slot else None
    return client.post(f"/api/vehicles/{vin}/service/{action}", headers=bearer(tok), json=body)


def active() -> list[tuple]:
    with engine.connect() as c:
        return c.execute(text("SELECT center_id, slot_start, status FROM appointments WHERE vin = :v "
                              "AND status IN ('held', 'booked')"), {"v": VIN}).all()


def open_bays(slot) -> int:
    with engine.connect() as c:
        return c.execute(text("SELECT count(*) FROM capacity_slots WHERE center_id = :c AND "
                              "slot_start = CAST(:s AS timestamptz) AND status = 'open'"),
                         {"c": slot["center_id"], "s": slot["slot_start"]}).scalar_one()


# ── what the phone is shown ─────────────────────────────────────────────────

def test_a_healthy_car_with_nothing_booked_is_a_quiet_screen(client, owner):
    s = view(client, owner)
    assert s["alert"] is None and s["booking"] is None and s["slots"] == []


def test_an_alert_comes_with_its_costs_and_local_slots(client, owner):
    predict("battery")
    s = view(client, owner)
    assert s["alert"]["component"] == "battery"
    assert s["economics"] == {"repair_inr": 5200, "breakdown_inr": 9000}
    assert 1 <= len(s["slots"]) <= 6
    assert {slot["city"] for slot in s["slots"]} == {CITY}


def test_the_phone_is_not_gated_on_drive_state(client, owner):
    # An owner at home: the car's last reading is old, which the car screen
    # treats as moving. The phone is not the car's display.
    predict()
    slot = view(client, owner)["slots"][0]
    assert post(client, owner, "book", slot).status_code == 200


# ── booking ─────────────────────────────────────────────────────────────────

def test_the_owner_books_an_offered_slot(client, owner):
    predict()
    slot = view(client, owner)["slots"][0]
    r = post(client, owner, "book", slot)
    assert r.status_code == 200, r.text
    assert r.json()["booking"]["status"] == "booked"
    s = view(client, owner)
    assert s["booking"]["center_id"] == slot["center_id"]
    assert len(active()) == 1


def test_an_owner_booking_says_who_made_it(client, owner):
    predict()
    post(client, owner, "book", view(client, owner)["slots"][0])
    with engine.connect() as c:
        by = c.execute(text("SELECT created_by_agent FROM appointments WHERE vin = :v"), {"v": VIN}).scalar()
    assert by == "owner_app"


def test_booking_again_is_refused_and_names_the_booking(client, owner):
    predict()
    first, second = view(client, owner)["slots"][:2]
    post(client, owner, "book", first)
    r = post(client, owner, "book", second)
    assert r.status_code == 409
    assert r.json()["detail"]["booking"]["center_id"] == first["center_id"]
    assert len(active()) == 1


def test_a_slot_in_another_city_is_refused(client, owner):
    predict()
    with engine.connect() as c:
        far = c.execute(text("SELECT cs.center_id, cs.slot_start FROM capacity_slots cs "
                             "JOIN service_centers sc ON sc.id = cs.center_id WHERE sc.city <> :c "
                             "AND cs.slot_start > now() AND cs.status = 'open' LIMIT 1"), {"c": CITY}).first()
    r = post(client, owner, "book", {"center_id": far.center_id, "slot_start": far.slot_start.isoformat()})
    assert r.status_code == 422
    assert active() == []


def test_a_slot_that_is_not_open_is_refused(client, owner):
    predict()
    slot = view(client, owner)["slots"][0]
    with engine.begin() as c:
        c.execute(text("UPDATE capacity_slots SET status = 'booked' WHERE center_id = :c "
                       "AND slot_start = CAST(:s AS timestamptz)"),
                  {"c": slot["center_id"], "s": slot["slot_start"]})
    r = post(client, owner, "book", slot)
    assert r.status_code == 409
    assert active() == []


# ── moving it ───────────────────────────────────────────────────────────────

def test_rescheduling_moves_the_booking_and_frees_the_old_bay(client, owner):
    predict()
    first, later = view(client, owner)["slots"][:2]
    post(client, owner, "book", first)
    freed_before = open_bays(first)
    r = post(client, owner, "reschedule", later)
    assert r.status_code == 200, r.text
    [(centre, start, status)] = active()
    assert centre == later["center_id"] and status == "booked"
    assert view(client, owner)["booking"]["slot_start"][:16] == later["slot_start"][:16]
    assert open_bays(first) == freed_before + 1


def test_a_failed_move_keeps_the_original_booking(client, owner):
    # The new slot went while the owner was choosing. They must not end up
    # with no booking at all.
    predict()
    first, later = view(client, owner)["slots"][:2]
    post(client, owner, "book", first)
    with engine.begin() as c:
        c.execute(text("UPDATE capacity_slots SET status = 'booked' WHERE center_id = :c "
                       "AND slot_start = CAST(:s AS timestamptz)"),
                  {"c": later["center_id"], "s": later["slot_start"]})
    r = post(client, owner, "reschedule", later)
    assert r.status_code == 409
    [(centre, _, status)] = active()
    assert centre == first["center_id"] and status == "booked"


def test_rescheduling_with_nothing_booked_is_refused(client, owner):
    predict()
    r = post(client, owner, "reschedule", view(client, owner)["slots"][0])
    assert r.status_code == 409
    assert active() == []


def test_a_move_to_another_city_is_refused(client, owner):
    predict()
    first = view(client, owner)["slots"][0]
    post(client, owner, "book", first)
    with engine.connect() as c:
        far = c.execute(text("SELECT cs.center_id, cs.slot_start FROM capacity_slots cs "
                             "JOIN service_centers sc ON sc.id = cs.center_id WHERE sc.city <> :c "
                             "AND cs.slot_start > now() AND cs.status = 'open' LIMIT 1"), {"c": CITY}).first()
    r = post(client, owner, "reschedule", {"center_id": far.center_id, "slot_start": far.slot_start.isoformat()})
    assert r.status_code == 422
    assert active()[0][0] == first["center_id"]


# ── cancelling ──────────────────────────────────────────────────────────────

def test_cancelling_frees_the_bay(client, owner):
    predict()
    slot = view(client, owner)["slots"][0]
    post(client, owner, "book", slot)
    before = open_bays(slot)
    r = post(client, owner, "cancel")
    assert r.status_code == 200, r.text
    assert active() == []
    assert open_bays(slot) == before + 1
    assert view(client, owner)["booking"] is None


def test_cancelling_with_nothing_booked_says_so(client, owner):
    assert post(client, owner, "cancel").status_code == 404


# ── who may ─────────────────────────────────────────────────────────────────

def test_it_needs_a_session(client):
    assert client.get(f"/api/vehicles/{VIN}/service").status_code == 401


def test_someone_elses_car_does_not_exist(client):
    stranger = token_for(client, make_user()["email"])
    assert client.get(f"/api/vehicles/{VIN}/service", headers=bearer(stranger)).status_code == 404
    predict()
    slot = view(client, token_for(client, OWNER))["slots"][0]
    assert post(client, stranger, "book", slot).status_code == 404
    assert active() == []
