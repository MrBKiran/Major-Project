"""
Findings from the security review of the authentication work.

Each test here reproduces something the review found; they pass only with the fix. (The
limiter's memory exhaustion is in test_ratelimit.py, MFA-enrolment step-up in test_mfa.py,
Google clock skew in test_google_verifier.py, and the operator MFA reset in test_manage.py.)
"""

from __future__ import annotations

import pytest

from app.auth import mfa

from .helpers import bearer, bump_token_version, claims_of, login, make_user, token_for
from .mfa_helpers import CONFIRM, ENROLL, PRIVILEGED


# ── M2: a racing revocation must not be defeated by minting a fresh token ──────────────

def test_a_switch_racing_a_revocation_cannot_mint_a_token_that_survives_it(client, monkeypatch):
    # The token is valid when the request is authenticated; "log out everywhere" lands
    # before the route body mints the new one. Reading token_version afresh at that point
    # would stamp the NEW value on the new token and quietly undo the revocation. The token
    # must carry the version the request was authenticated with.
    from app.auth import deps

    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")

    real_hydrate = deps.hydrate

    def revoke_after_authentication(principal):
        bump_token_version(principal.user_id)          # the gap between validation and the body
        return real_hydrate(principal)

    monkeypatch.setattr(deps, "hydrate", revoke_after_authentication)
    r = client.post("/api/auth/switch", json={"org_id": "ORG-CUSTOMERS", "role": "vehicle_owner"},
                    headers=bearer(tok))
    monkeypatch.setattr(deps, "hydrate", real_hydrate)

    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers=bearer(r.json()["access_token"])).status_code == 401,         "a revoked session was resurrected by a racing switch"


def test_completing_enrolment_racing_a_revocation_cannot_mint_a_surviving_session(
        client, clock, monkeypatch):
    monkeypatch.setattr(mfa.settings, "mfa_enforcement", True)
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    secret = client.post(ENROLL, headers=bearer(tok)).json()["secret"]

    real = mfa.confirm_enrollment

    def revoke_in_the_gap(conn, user_id, code):
        result = real(conn, user_id, code)
        bump_token_version(user_id)
        return result

    monkeypatch.setattr("app.api_mfa.mfa.confirm_enrollment", revoke_in_the_gap)
    r = client.post(CONFIRM, json={"code": clock.code(secret)}, headers=bearer(tok))
    monkeypatch.setattr("app.api_mfa.mfa.confirm_enrollment", real)

    session = (r.json().get("session") if r.status_code == 200 else None)
    if session:
        assert client.get("/api/auth/me",
                          headers=bearer(session["access_token"])).status_code == 401


def test_the_new_token_carries_the_version_the_request_was_authenticated_with(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    r = client.post("/api/auth/switch", json={"org_id": "ORG-CUSTOMERS", "role": "vehicle_owner"},
                    headers=bearer(tok))
    assert claims_of(r.json()["access_token"])["tv"] == claims_of(tok)["tv"]


# ── M3: changing a password costs real CPU, so it has a budget ─────────────────────────

def test_password_change_attempts_are_capped_per_minute(client):
    # Every attempt hashes twice (the current password, then the new one against it) — about
    # a second of CPU. Policy failures do not count as wrong guesses, so without a budget an
    # authenticated user could spin a worker indefinitely with them.
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    codes = [client.post("/api/auth/password/change", headers=bearer(tok),
                         json={"current_password": u["password"], "new_password": "short"}
                         ).status_code for _ in range(21)]
    assert codes[:20] == [422] * 20 and codes[20] == 429


# ── M6: nothing here may be cached or sniffed ──────────────────────────────────────────

@pytest.mark.parametrize("method,path", [
    ("get", "/api/auth/config"),
    ("post", "/api/auth/login"),
    ("post", "/api/auth/otp/request"),
    ("get", "/api/auth/me"),
])
def test_auth_responses_are_never_cacheable(client, method, path):
    r = getattr(client, method)(path, **({"json": {}} if method == "post" else {}))
    assert r.headers.get("Cache-Control") == "no-store", (path, dict(r.headers))


def test_every_response_forbids_content_type_sniffing(client):
    assert client.get("/api/health/live").headers.get("X-Content-Type-Options") == "nosniff"
    assert client.get("/api/auth/config").headers.get("X-Content-Type-Options") == "nosniff"


def test_unrelated_endpoints_are_not_forced_uncacheable(client):
    # no-store is for credentials; blanket-applying it would defeat caching for no gain.
    assert client.get("/api/health/live").headers.get("Cache-Control") != "no-store"


# ── L1: the public readiness probe says up or down and nothing else ────────────────────

def test_readiness_reports_only_up_or_down(client):
    body = client.get("/api/health/ready").json()
    assert set(body) == {"status", "checks"}
    for name, check in body["checks"].items():
        assert set(check) == {"ok"}, f"{name} reports more than up/down: {check}"
