"""
Phase 6 — when a second factor is REQUIRED, what a half-signed-in user may do, and how
the secrets are protected.

MFA_ENFORCEMENT turns the policy's `mfa_required` roles from "recommended" into "no
session without it". A privileged user who has not enrolled yet is not locked out
(they could never enrol) and not let in either: they get an ENROLMENT-ONLY session that
can enrol and nothing else, and completing enrolment hands back the full one.

Also here: recovery-code regeneration, disabling, the admin reset for a lost device,
and the encryption-key configuration.
"""

from __future__ import annotations


import pytest
from cryptography.fernet import InvalidToken
from sqlalchemy import text

from app.auth.audit import tail
from app.config import settings
from app.db.session import engine

from .helpers import (
    bearer, claims_of, login, make_user, token_for,
)
from .mfa_helpers import (
    CONFIRM, DISABLE, ENROLL, PRIVILEGED, RECOVERY, STAFF, STATUS, challenge, enrol, enrolled_user,
    not_the, sign_in_with_totp, verify,
)
from .ws_helpers import FORBIDDEN, auth_message, close_code

RESET = "/api/auth/users/{}/reset-mfa"


@pytest.fixture
def enforced(monkeypatch):
    monkeypatch.setattr(settings, "mfa_enforcement", True)


# ── enforcement ────────────────────────────────────────────────────────────

def test_with_enforcement_off_privileged_users_are_not_made_to_enrol(client):
    u = make_user(memberships=PRIVILEGED)
    r = login(client, u["email"], u["password"])
    assert r.status_code == 200 and r.json().get("next_step") is None
    assert claims_of(r.json()["access_token"])["scp"] == "full"


def test_an_unenrolled_privileged_user_gets_an_enrolment_only_session(client, enforced):
    u = make_user(memberships=PRIVILEGED)
    r = login(client, u["email"], u["password"])

    assert r.status_code == 200, r.text
    assert r.json()["next_step"] == "mfa_enroll"
    tok = r.json()["access_token"]
    assert claims_of(tok)["scp"] == "mfa_enroll"
    # It can enrol...
    assert client.post(ENROLL, headers=bearer(tok)).status_code == 200
    # ...and nothing else.
    for path in ("/api/auth/me", "/api/auth/memberships", "/api/ueba/matrix", "/api/fleet"):
        assert client.get(path, headers=bearer(tok)).status_code == 403, path
    assert client.post("/api/auth/password/change", headers=bearer(tok),
                       json={"current_password": "x", "new_password": "y" * 12}).status_code == 403


def test_completing_enrolment_from_that_session_returns_the_full_one(client, clock, enforced):
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    secret = client.post(ENROLL, headers=bearer(tok)).json()["secret"]

    r = client.post(CONFIRM, json={"code": clock.code(secret)}, headers=bearer(tok))
    assert r.status_code == 200 and len(r.json()["recovery_codes"]) == 10
    session = r.json()["session"]
    assert session and claims_of(session["access_token"])["scp"] == "full"
    assert claims_of(session["access_token"])["amr"] == ["password", "totp"]
    assert client.get("/api/auth/me", headers=bearer(session["access_token"])).status_code == 200


def test_once_enrolled_the_ordinary_two_step_sign_in_applies(client, clock, enforced):
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    secret, _, _ = enrol(client, tok, clock)
    r = login(client, u["email"], u["password"])
    assert r.status_code == 202
    assert verify(client, r.json()["mfa_token"], clock.code(secret)).status_code == 200


@pytest.mark.parametrize("role,org", [("fleet_manager", "ORG-RAMAN"),
                                      ("vehicle_owner", "ORG-CUSTOMERS"),
                                      ("oem_quality_engineer", "ORG-MAHINDRA")])
def test_enforcement_leaves_roles_that_do_not_require_it_alone(client, enforced, role, org):
    u = make_user(memberships=[(org, role)])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 200 and claims_of(r.json()["access_token"])["scp"] == "full"


@pytest.mark.parametrize("role,org", [("platform_admin", "ORG-PLATFORM"),
                                      ("security_analyst", "ORG-PLATFORM"),
                                      ("oem_quality_manager", "ORG-MAHINDRA"),
                                      ("centre_manager", "ORG-WESTERN"),
                                      ("service_advisor", "ORG-WESTERN")])
def test_every_role_the_policy_marks_gets_the_enrolment_session(client, enforced, role, org):
    u = make_user(memberships=[(org, role)])
    assert login(client, u["email"], u["password"]).json()["next_step"] == "mfa_enroll"


def test_the_enrolment_only_token_is_short_lived(client, enforced):
    u = make_user(memberships=PRIVILEGED)
    claims = claims_of(login(client, u["email"], u["password"]).json()["access_token"])
    assert 0 < claims["exp"] - claims["iat"] <= 15 * 60


def test_an_enrolment_only_token_cannot_open_the_event_stream(client, enforced):
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    assert close_code(client, auth_message(tok)) == FORBIDDEN


def test_google_and_phone_sessions_are_held_to_the_same_rule(client, enforced, google):
    u = make_user(memberships=PRIVILEGED)
    cred = google.add("c", sub="g-enf-" + u["id"][-6:], email=u["email"])
    r = client.post("/api/auth/google", json={"credential": cred})
    assert r.status_code == 200 and r.json()["next_step"] == "mfa_enroll"


def test_switching_into_a_role_that_requires_mfa_needs_a_second_factor(client, clock, enforced):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-PLATFORM", "security_analyst")])
    tok = login(client, u["email"], u["password"], org_id="ORG-CUSTOMERS",
                role="vehicle_owner").json()["access_token"]
    body = {"org_id": "ORG-PLATFORM", "role": "security_analyst"}
    assert client.post("/api/auth/switch", json=body, headers=bearer(tok)).status_code == 403
    listed = client.get("/api/auth/memberships", headers=bearer(tok)).json()["memberships"]
    assert {m["role"] for m in listed} == {"vehicle_owner"}

    # After signing in WITH the second factor the same switch is allowed.
    secret, _, _ = enrol(client, tok, clock)
    ident = {**u, "secret": secret}
    full = sign_in_with_totp(client, ident, clock, org_id="ORG-CUSTOMERS",
                             role="vehicle_owner").json()["access_token"]
    assert client.post("/api/auth/switch", json=body, headers=bearer(full)).status_code == 200


# ── status / disable / recovery ────────────────────────────────────────────

def test_status_reports_enrolment_and_whether_the_role_requires_it(client, clock, enforced):
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    assert client.get(STATUS, headers=bearer(tok)).status_code == 403     # enrolment-only session
    secret, _, confirmed = enrol(client, tok, clock)
    full = confirmed.json()["session"]["access_token"]
    assert client.get(STATUS, headers=bearer(full)).json() == {
        "enrolled": True, "required": True, "recovery_codes_remaining": 10, "has_password": True}


def test_a_user_can_switch_mfa_off_when_their_role_does_not_require_it(client, clock):
    u = enrolled_user(client, clock)
    tok = sign_in_with_totp(client, u, clock).json()["access_token"]
    r = client.post(DISABLE, json={"code": clock.code(u["secret"])}, headers=bearer(tok))
    assert r.status_code == 200
    assert login(client, u["email"], u["password"]).status_code == 200      # no challenge any more
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM user_mfa WHERE user_id = :u"),
                            {"u": u["id"]}).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM mfa_recovery_codes WHERE user_id = :u"),
                            {"u": u["id"]}).scalar() == 0


def test_disabling_needs_a_valid_code_not_just_a_session(client, clock):
    u = enrolled_user(client, clock)
    tok = sign_in_with_totp(client, u, clock).json()["access_token"]
    r = client.post(DISABLE, json={"code": not_the(clock.code(u["secret"]))}, headers=bearer(tok))
    assert r.status_code == 403
    assert login(client, u["email"], u["password"]).status_code == 202      # still on


def test_a_role_that_requires_mfa_cannot_switch_it_off_under_enforcement(client, clock, enforced):
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    secret, _, confirmed = enrol(client, tok, clock)
    full = confirmed.json()["session"]["access_token"]
    r = client.post(DISABLE, json={"code": clock.code(secret)}, headers=bearer(full))
    assert r.status_code == 403


def test_regenerating_recovery_codes_invalidates_the_old_ones(client, clock):
    u = enrolled_user(client, clock)
    tok = sign_in_with_totp(client, u, clock).json()["access_token"]
    r = client.post(RECOVERY, json={"code": clock.code(u["secret"])}, headers=bearer(tok))
    assert r.status_code == 200
    fresh = r.json()["recovery_codes"]
    assert len(fresh) == 10 and not set(fresh) & set(u["recovery"])

    assert verify(client, challenge(client, u), u["recovery"][0]).status_code == 401   # old: dead
    assert verify(client, challenge(client, u), fresh[0]).status_code == 200            # new: works


def test_regenerating_needs_a_valid_code(client, clock):
    u = enrolled_user(client, clock)
    tok = sign_in_with_totp(client, u, clock).json()["access_token"]
    r = client.post(RECOVERY, json={"code": not_the(clock.code(u["secret"]))}, headers=bearer(tok))
    assert r.status_code == 403


# ── a lost device ──────────────────────────────────────────────────────────

def test_an_admin_can_reset_a_users_second_factor(client, clock):
    u = enrolled_user(client, clock)
    admin = token_for(client, "admin@autosaarthi.io")

    r = client.post(RESET.format(u["id"]), headers=bearer(admin))
    assert r.status_code == 200

    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM user_mfa WHERE user_id = :u"),
                            {"u": u["id"]}).scalar() == 0
    assert login(client, u["email"], u["password"]).status_code == 200      # plain sign-in again
    assert any(e["action"] == "auth.mfa_reset" for e in tail(limit=50, subject=u["id"]))


def test_a_reset_also_ends_the_users_sessions(client, clock):
    u = enrolled_user(client, clock)
    session = sign_in_with_totp(client, u, clock).json()["access_token"]
    client.post(RESET.format(u["id"]), headers=bearer(token_for(client, "admin@autosaarthi.io")))
    assert client.get("/api/auth/me", headers=bearer(session)).status_code == 401


def test_only_an_administrator_can_reset_someone_elses_second_factor(client, clock):
    u = enrolled_user(client, clock)
    other = make_user(memberships=STAFF)
    tok = token_for(client, other["email"], other["password"])
    assert client.post(RESET.format(u["id"]), headers=bearer(tok)).status_code == 403
    assert client.post(RESET.format(u["id"])).status_code == 401


def test_resetting_an_unknown_user_is_a_404(client):
    admin = token_for(client, "admin@autosaarthi.io")
    assert client.post(RESET.format("USR-nobody"), headers=bearer(admin)).status_code == 404


def test_after_a_reset_the_user_can_enrol_again(client, clock):
    u = enrolled_user(client, clock)
    client.post(RESET.format(u["id"]), headers=bearer(token_for(client, "admin@autosaarthi.io")))
    tok = token_for(client, u["email"], u["password"])
    secret, recovery, _ = enrol(client, tok, clock)
    assert len(recovery) == 10 and secret


# ── configuration ──────────────────────────────────────────────────────────

def _fernet_key() -> str:
    from cryptography.fernet import Fernet

    return Fernet.generate_key().decode()


def test_production_refuses_to_start_without_a_dedicated_key(monkeypatch):
    from app.auth.mfa import MfaConfigurationError, validate_mfa_config

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "mfa_encryption_key", "")
    with pytest.raises(MfaConfigurationError, match="MFA_ENCRYPTION_KEY"):
        validate_mfa_config()


@pytest.mark.parametrize("environment", ["development", "production"])
@pytest.mark.parametrize("bad", ["short", "not base64 !!!", "a" * 44])
def test_a_malformed_key_is_refused_everywhere(monkeypatch, environment, bad):
    from app.auth.mfa import MfaConfigurationError, validate_mfa_config

    monkeypatch.setattr(settings, "environment", environment)
    monkeypatch.setattr(settings, "mfa_encryption_key", bad)
    with pytest.raises(MfaConfigurationError):
        validate_mfa_config()


def test_a_good_key_is_accepted_quietly(monkeypatch):
    from app.auth.mfa import validate_mfa_config

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "mfa_encryption_key", _fernet_key())
    assert validate_mfa_config() == []


def test_development_without_a_key_works_and_warns_only_when_mfa_is_enforced(monkeypatch):
    from app.auth.mfa import validate_mfa_config

    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "mfa_encryption_key", "")
    monkeypatch.setattr(settings, "mfa_enforcement", False)
    assert validate_mfa_config() == []
    monkeypatch.setattr(settings, "mfa_enforcement", True)
    warnings = validate_mfa_config()
    assert warnings and "MFA_ENCRYPTION_KEY" in warnings[0]


def test_a_dedicated_key_keeps_secrets_readable_when_the_jwt_secret_rotates(monkeypatch):
    from app.auth import mfa

    monkeypatch.setattr(settings, "mfa_encryption_key", _fernet_key())
    sealed = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    monkeypatch.setattr(settings, "jwt_secret", "a-completely-different-key-" + "z" * 24)
    assert mfa.decrypt_secret(sealed) == "JBSWY3DPEHPK3PXP"


def test_without_a_dedicated_key_secrets_follow_the_jwt_secret(monkeypatch):
    # The documented dev-mode trade-off: rotating JWT_SECRET orphans enrolled users.
    from app.auth import mfa

    monkeypatch.setattr(settings, "mfa_encryption_key", "")
    sealed = mfa.encrypt_secret("JBSWY3DPEHPK3PXP")
    assert mfa.decrypt_secret(sealed) == "JBSWY3DPEHPK3PXP"
    monkeypatch.setattr(settings, "jwt_secret", "a-completely-different-key-" + "z" * 24)
    with pytest.raises(InvalidToken):
        mfa.decrypt_secret(sealed)


def test_the_app_refuses_to_start_when_the_mfa_configuration_is_fatal(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    class Sentinel(Exception):
        pass

    def boom():
        raise Sentinel

    monkeypatch.setattr(main, "validate_mfa_config", boom)
    with pytest.raises(Sentinel):
        with TestClient(main.app):
            pass
