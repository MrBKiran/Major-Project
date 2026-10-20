"""
The car screen (Phase 3): what a head unit — the web console's, or Android Auto
— may show, decided by the server.

Before: the web head unit sent its own drive state (a dropdown), was shown a
hard-coded "Tue 09:30 · Rajkot" slot for a car in Bengaluru, and its Book button
changed nothing but local state. Now the state comes from the car's latest
telemetry, missing or stale telemetry counts as moving (the safe direction),
slots are real and local, and booking goes through the guarded scheduler.
"""

from __future__ import annotations

import datetime as dt

import pytest
from sqlalchemy import text

from app.config import settings
from app.db.session import engine

from .auth.helpers import bearer, make_user, token_for

VIN = "MH12AB1002"          # a Mumbai car in vehicles.yaml
CITY = "Mumbai"


@pytest.fixture(autouse=True)
def _clean():
    yield
    with engine.begin() as c:
        for table in ("telemetry", "predictions", "appointments"):
            c.execute(text(f"DELETE FROM {table} WHERE vin = :v"), {"v": VIN})
        c.execute(text("UPDATE capacity_slots SET status = 'open' WHERE slot_start > now() "
                       "AND center_id IN (SELECT id FROM service_centers WHERE city = :c)"), {"c": CITY})


@pytest.fixture
def admin(client):
    return token_for(client, "admin@autosaarthi.io")


def reading(drive_state, *, speed=0.0, ago_s=5):
    with engine.begin() as c:
        c.execute(text("INSERT INTO telemetry (ts, vin, speed, drive_state) "
                       "VALUES (now() - make_interval(secs => :a), :v, :s, :d)"),
                  {"a": ago_s, "v": VIN, "s": speed, "d": drive_state})


def predict(component="water_pump", severity="P1", days=1.0):
    with engine.begin() as c:
        c.execute(text("INSERT INTO predictions (id, vin, ts, component, failure_prob, days_to_failure, "
                       "severity, model_version) VALUES (:id, :v, now(), :c, 0.9, :d, :s, 'test')"),
                  {"id": f"PRD-{component[:8]}", "v": VIN, "c": component, "d": days, "s": severity})


def screen(client, tok, vin=VIN, **params):
    r = client.get(f"/api/car/{vin}/screen", headers=bearer(tok), params=params)
    assert r.status_code == 200, r.text
    return r.json()


def book(client, tok, slot, vin=VIN):
    return client.post(f"/api/car/{vin}/book", headers=bearer(tok),
                       json={"center_id": slot["center_id"], "slot_start": slot["slot_start"]})


# ── drive state, decided by the server ──────────────────────────────────────

def test_a_fresh_parked_reading_is_parked(client, admin):
    reading("PARKED")
    s = screen(client, admin)
    assert s["drive"]["state"] == "PARKED" and s["drive"]["basis"] == "telemetry"
    assert s["allowed"]["touch"] is True


def test_driving_allows_no_touch_and_one_element(client, admin):
    reading("DRIVING", speed=68)
    s = screen(client, admin)
    assert s["drive"]["state"] == "DRIVING"
    assert s["allowed"] == {"touch": False, "slots": False, "max_elements": 1}


def test_a_brief_stop_is_still_not_parked(client, admin):
    reading("STOPPED_BRIEF")
    assert screen(client, admin)["allowed"]["touch"] is False


def test_ignition_off_counts_as_parked(client, admin):
    reading("IGNITION_OFF")
    assert screen(client, admin)["drive"]["state"] == "PARKED"


def test_no_telemetry_at_all_is_treated_as_moving(client, admin):
    s = screen(client, admin)
    assert s["drive"]["state"] == "DRIVING" and s["drive"]["basis"] == "none"
    assert s["allowed"]["touch"] is False


def test_a_stale_parked_reading_is_treated_as_moving(client, admin):
    # The link dropped; the car may have driven off since. Fail safe.
    reading("PARKED", ago_s=600)
    s = screen(client, admin)
    assert s["drive"]["state"] == "DRIVING" and s["drive"]["basis"] == "stale"


def test_parked_at_speed_is_a_contradiction_treated_as_moving(client, admin):
    reading("PARKED", speed=40)
    s = screen(client, admin)
    assert s["drive"]["state"] == "DRIVING" and s["drive"]["basis"] == "contradiction"


def test_the_client_cannot_assert_its_own_drive_state(client, admin):
    reading("DRIVING", speed=68)
    assert screen(client, admin, drive_state="PARKED")["drive"]["state"] == "DRIVING"


# ── what the screen shows ───────────────────────────────────────────────────

def test_a_healthy_car_has_nothing_to_show(client, admin):
    reading("PARKED")
    s = screen(client, admin)
    assert s["alert"] is None and s["slots"] == []


def test_parked_with_an_alert_offers_real_local_slots(client, admin):
    reading("PARKED")
    predict("water_pump", "P1", 1.0)
    s = screen(client, admin)
    assert s["alert"]["component"] == "water_pump" and s["alert"]["severity"] == "P1"
    assert s["alert"]["days_to_failure"] == pytest.approx(1.0)
    assert 1 <= len(s["slots"]) <= 3
    assert {slot["city"] for slot in s["slots"]} == {CITY}      # not Rajkot


def test_costs_come_from_the_fleet_data_not_the_screen(client, admin):
    # The web screens hard-coded these and had two components wrong.
    reading("PARKED")
    predict("battery", "P2", 6.0)
    assert screen(client, admin)["economics"] == {"repair_inr": 5200, "breakdown_inr": 9000}


def test_driving_sends_no_slots_at_all(client, admin):
    reading("DRIVING", speed=68)
    predict()
    s = screen(client, admin)
    assert s["alert"] is not None and s["slots"] == []


# ── who may see it ──────────────────────────────────────────────────────────

def test_the_screen_needs_a_session(client):
    assert client.get(f"/api/car/{VIN}/screen").status_code == 401


def test_someone_elses_car_does_not_exist(client):
    tok = token_for(client, make_user()["email"])
    assert client.get(f"/api/car/{VIN}/screen", headers=bearer(tok)).status_code == 404


# ── booking from the car ────────────────────────────────────────────────────

def _offered(client, admin):
    reading("PARKED")
    predict()
    return screen(client, admin)["slots"][0]


def _bookings():
    with engine.connect() as c:
        return c.execute(text("SELECT status FROM appointments WHERE vin = :v AND status IN "
                              "('held', 'booked')"), {"v": VIN}).scalars().all()


def test_parked_the_driver_can_book_the_offered_slot(client, admin):
    slot = _offered(client, admin)
    r = book(client, admin, slot)
    assert r.status_code == 200 and r.json()["booked"] is True
    assert _bookings() == ["booked"]


def test_booking_is_refused_while_driving_and_holds_nothing(client, admin):
    slot = _offered(client, admin)
    reading("DRIVING", speed=68)
    r = book(client, admin, slot)
    assert r.status_code == 409
    assert _bookings() == []


def test_booking_is_refused_without_fresh_telemetry(client, admin):
    slot = _offered(client, admin)
    with engine.begin() as c:
        c.execute(text("DELETE FROM telemetry WHERE vin = :v"), {"v": VIN})
    assert book(client, admin, slot).status_code == 409


def test_booking_twice_keeps_one_booking(client, admin):
    slot = _offered(client, admin)
    book(client, admin, slot)
    again = book(client, admin, slot)
    assert again.status_code == 200 and again.json()["already_booked"] is True
    assert _bookings() == ["booked"]


def test_after_booking_the_screen_shows_it_instead_of_offering_more(client, admin):
    # A reloaded head unit must not offer to book a car that is already booked.
    slot = _offered(client, admin)
    book(client, admin, slot)
    s = screen(client, admin)
    assert s["booking"]["center_id"] == slot["center_id"]
    assert dt.datetime.fromisoformat(s["booking"]["slot_start"]) ==         dt.datetime.fromisoformat(slot["slot_start"])
    assert s["booking"]["city"] == CITY and s["booking"]["status"] == "booked"
    assert s["slots"] == []


def test_with_nothing_booked_there_is_no_booking_to_show(client, admin):
    reading("PARKED")
    predict()
    assert screen(client, admin)["booking"] is None


def test_last_months_service_is_not_a_booking(client, admin):
    reading("PARKED")
    predict()
    with engine.begin() as c:
        c.execute(text("INSERT INTO appointments (id, vin, center_id, slot_start, status) "
                       "SELECT 'APT-PAST', :v, id, now() - interval '30 days', 'booked' "
                       "FROM service_centers WHERE city = :c LIMIT 1"), {"v": VIN, "c": CITY})
    s = screen(client, admin)
    assert s["booking"] is None and len(s["slots"]) >= 1


def test_the_old_console_demo_that_took_the_pages_word_is_gone(client, admin):
    # POST /api/console/demo ran the console tools with whatever drive state
    # the page sent. The guard blocking a tap at speed is still demonstrated —
    # by red-team ATTACK-5, which is restricted to redteam:run.
    r = client.post("/api/console/demo", headers=bearer(admin),
                    json={"vin": VIN, "drive_state": "PARKED", "speed_kmph": 0})
    assert r.status_code == 404


def test_a_slot_in_another_city_is_refused(client, admin):
    reading("PARKED")
    predict()
    with engine.connect() as c:
        far = c.execute(text("SELECT cs.center_id, cs.slot_start FROM capacity_slots cs "
                             "JOIN service_centers sc ON sc.id = cs.center_id "
                             "WHERE sc.city = 'Rajkot' AND cs.slot_start > now() AND cs.status = 'open' "
                             "ORDER BY cs.slot_start LIMIT 1")).first()
    r = book(client, admin, {"center_id": far.center_id, "slot_start": far.slot_start.isoformat()})
    assert r.status_code == 422
    assert _bookings() == []


# ── the demo's drive-state control ──────────────────────────────────────────

def test_the_demo_control_sets_the_cars_state_on_the_server(client, admin, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)
    r = client.post(f"/api/car/{VIN}/simulate", headers=bearer(admin), json={"drive_state": "PARKED"})
    assert r.status_code == 200
    assert screen(client, admin)["drive"] == {**screen(client, admin)["drive"],
                                              "state": "PARKED", "basis": "telemetry"}


def test_an_owner_cannot_fake_their_cars_state(client, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)      # refused for who they are, not the mode
    # Faking PARKED at speed would unlock the booking screen — the very thing G6 forbids.
    tok = token_for(client, "ramesh.pawar@example.in")
    r = client.post("/api/car/MH12AB1001/simulate", headers=bearer(tok), json={"drive_state": "PARKED"})
    assert r.status_code == 403


def test_the_screen_says_whether_this_caller_has_the_demo_control(client, admin, monkeypatch):
    # The page shows the drive-state control only when it would work, rather
    # than offering one that the server then refuses.
    monkeypatch.setattr(settings, "demo_mode", True)
    assert screen(client, admin)["controls"] == {"drive_state": True}
    monkeypatch.setattr(settings, "demo_mode", False)
    assert screen(client, admin)["controls"] == {"drive_state": False}


def test_an_owner_is_never_offered_the_demo_control(client, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", True)
    tok = token_for(client, "ramesh.pawar@example.in")
    assert screen(client, tok, vin="MH12AB1001")["controls"] == {"drive_state": False}


def test_the_demo_control_is_off_outside_demo_mode(client, admin, monkeypatch):
    monkeypatch.setattr(settings, "demo_mode", False)
    r = client.post(f"/api/car/{VIN}/simulate", headers=bearer(admin), json={"drive_state": "PARKED"})
    assert r.status_code == 404
