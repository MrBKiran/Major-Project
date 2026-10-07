"""Helpers for driving the second-factor flows through the API."""

from __future__ import annotations

from .helpers import DEFAULT_PASSWORD, bearer, login, make_user, token_for

STAFF = [("ORG-RAMAN", "fleet_manager")]              # mfa_required: false in the policy
PRIVILEGED = [("ORG-PLATFORM", "security_analyst")]   # mfa_required: true

ENROLL, CONFIRM, VERIFY = "/api/auth/mfa/enroll", "/api/auth/mfa/confirm", "/api/auth/mfa/verify"
STATUS, DISABLE, RECOVERY = "/api/auth/mfa", "/api/auth/mfa/disable", "/api/auth/mfa/recovery-codes"


# A FULL session must re-confirm the password to start enrolment (an enrolment-only session
# just did, so the field is ignored there). Every test user is made with this password.
PW = {"current_password": DEFAULT_PASSWORD}


def enrol(client, token, clock):
    """Enrol and confirm through the API. Returns (secret, recovery_codes, confirm_response)."""
    started = client.post(ENROLL, json=PW, headers=bearer(token))
    assert started.status_code == 200, started.text
    secret = started.json()["secret"]
    confirmed = client.post(CONFIRM, json={"code": clock.code(secret)}, headers=bearer(token))
    assert confirmed.status_code == 200, confirmed.text
    clock.advance(30)          # the enrolment code is spent; the next comes from the next step
    return secret, confirmed.json()["recovery_codes"], confirmed


def enrolled_user(client, clock, memberships=STAFF) -> dict:
    """A user with a working second factor: {id, email, password, secret, recovery}."""
    u = make_user(memberships=memberships)
    token = token_for(client, u["email"], u["password"])
    secret, recovery, _ = enrol(client, token, clock)
    return {**u, "secret": secret, "recovery": recovery}


def challenge(client, u, **extra):
    """Sign in by password as an enrolled user; expect the second-factor challenge."""
    r = login(client, u["email"], u["password"], **extra)
    assert r.status_code == 202, f"expected a challenge, got {r.status_code}: {r.text}"
    return r.json()["mfa_token"]


def verify(client, mfa_token, code):
    return client.post(VERIFY, json={"mfa_token": mfa_token, "code": code})


def sign_in_with_totp(client, u, clock, **extra):
    """Full password + TOTP sign-in. Returns the verify response."""
    token = challenge(client, u, **extra)
    response = verify(client, token, clock.code(u["secret"]))
    clock.advance(30)
    return response


def not_the(code: str) -> str:
    return "000000" if code != "000000" else "111111"
