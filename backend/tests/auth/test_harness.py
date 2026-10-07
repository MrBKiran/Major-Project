"""
Phase 0 — the harness itself.

These are the tests that let every later auth test be trusted: they prove the
suite runs against an isolated, seeded database rather than the one the demo
uses, and that the app can be driven in-process (which is what allows a fake
SMS sender and a fake Google verifier to be injected — impossible against a
separate server process).
"""

from __future__ import annotations

from sqlalchemy import text


def test_suite_uses_the_throwaway_database(db_engine):
    # If this ever points at the demo database, every later test that bumps a
    # token_version or deactivates a user would log the demo out.
    name = db_engine.url.database
    assert name == "autosaarthi_test"


def test_tenancy_seed_is_present(db_engine):
    with db_engine.connect() as conn:
        roles = {r[0] for r in conn.execute(text("SELECT DISTINCT role FROM memberships"))}
        admin = conn.execute(
            text("SELECT 1 FROM users WHERE email = 'admin@autosaarthi.io'")).first()
    assert admin is not None
    assert "platform_admin" in roles and "vehicle_owner" in roles


def test_app_is_driven_in_process(client):
    r = client.post("/api/auth/login",
                    json={"email": "admin@autosaarthi.io", "password": "autosaarthi"})
    assert r.status_code == 200, r.text
    assert r.json()["access_token"]


def test_health_liveness_is_public(client):
    assert client.get("/api/health/live").status_code == 200


def test_login_limiter_state_does_not_leak_between_tests(client):
    # Burn the per-account budget...
    for _ in range(12):
        client.post("/api/auth/login", json={"email": "aditi.nair@example.in", "password": "nope"})
    # ...the autouse reset must mean the NEXT test starts with a clean slate.


def test_a_fresh_test_starts_with_clean_limits(client):
    r = client.post("/api/auth/login",
                    json={"email": "aditi.nair@example.in", "password": "autosaarthi"})
    assert r.status_code == 200, r.text
