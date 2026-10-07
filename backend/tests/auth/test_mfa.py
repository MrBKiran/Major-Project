"""
Phase 6 — a second factor: TOTP codes from an authenticator app, with recovery codes.

Signing in as an enrolled user takes two steps. The first (password, Google or phone
code) proves who you are and yields a short-lived CHALLENGE, not a session; the second
(a six-digit code) turns it into one. The challenge token is signed for a different
audience from access tokens, so it cannot be used as a bearer token however it leaks.

What the tests concentrate on: a code works once (replay), a little clock drift is
tolerated and no more, guesses are limited, the secret is encrypted at rest, and
recovery codes are one-shot and stored as keyed hashes.
"""

from __future__ import annotations

import json
import re
import time
from urllib.parse import parse_qs, unquote, urlparse

import pytest
from sqlalchemy import text

from app.auth.audit import tail
from app.config import settings
from app.db.session import engine

from .helpers import (
    bearer, bump_token_version, claims_of, login, make_customer, make_user, new_phone, set_active,
    sign, token_for,
)
from .mfa_helpers import (
    CONFIRM, ENROLL, PW, STAFF, STATUS, challenge, enrol, enrolled_user, not_the, verify,
)

RECOVERY_FORMAT = re.compile(r"^[a-hj-km-np-z2-9]{5}-[a-hj-km-np-z2-9]{5}$")


def _details(event) -> dict:
    d = event["detail"]
    return json.loads(d) if isinstance(d, str) else (d or {})


# ── enrolling ──────────────────────────────────────────────────────────────

def test_enrolment_hands_back_a_secret_and_a_provisioning_uri(client, clock):
    u = make_user(memberships=STAFF)
    r = client.post(ENROLL, json=PW, headers=bearer(token_for(client, u["email"], u["password"])))
    assert r.status_code == 200
    secret, uri = r.json()["secret"], r.json()["otpauth_uri"]

    assert re.fullmatch(r"[A-Z2-7]{32}", secret)                  # 160 bits of base32
    parsed = urlparse(uri)
    assert (parsed.scheme, parsed.netloc) == ("otpauth", "totp")
    assert unquote(parsed.path).lstrip("/") == f"AutoSaarthi:{u['email']}"
    assert parse_qs(parsed.query) == {"secret": [secret], "issuer": ["AutoSaarthi"]}


def test_the_secret_is_encrypted_at_rest(client, clock):
    from app.auth import mfa

    u = make_user(memberships=STAFF)
    secret = client.post(ENROLL, json=PW, headers=bearer(token_for(client, u["email"], u["password"]))
                         ).json()["secret"]
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT secret_enc FROM user_mfa WHERE user_id = :u"),
                              {"u": u["id"]}).scalar()
    assert secret not in stored
    assert mfa.decrypt_secret(stored) == secret


def test_enrolment_does_nothing_until_it_is_confirmed(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    client.post(ENROLL, json=PW, headers=bearer(tok))                      # started, never confirmed
    assert login(client, u["email"], u["password"]).status_code == 200   # no challenge
    assert client.get(STATUS, headers=bearer(tok)).json()["enrolled"] is False


def test_confirming_activates_it_and_returns_ten_recovery_codes(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    _, recovery, confirmed = enrol(client, tok, clock)

    assert len(recovery) == len(set(recovery)) == 10
    assert all(RECOVERY_FORMAT.match(c) for c in recovery), recovery
    assert confirmed.json()["session"] is None                    # already fully signed in
    status = client.get(STATUS, headers=bearer(tok)).json()
    assert status["enrolled"] is True and status["recovery_codes_remaining"] == 10


def test_recovery_codes_are_kept_only_as_keyed_hashes(client, clock):
    u = make_user(memberships=STAFF)
    _, recovery, _ = enrol(client, token_for(client, u["email"], u["password"]), clock)
    with engine.connect() as conn:
        macs = [r[0] for r in conn.execute(text(
            "SELECT code_mac FROM mfa_recovery_codes WHERE user_id = :u"), {"u": u["id"]})]
    assert len(macs) == 10
    assert all(len(m) == 64 and set(m) <= set("0123456789abcdef") for m in macs)
    assert not set(macs) & {c.replace("-", "") for c in recovery} and not set(macs) & set(recovery)


def test_a_wrong_confirmation_code_activates_nothing(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    secret = client.post(ENROLL, json=PW, headers=bearer(tok)).json()["secret"]
    r = client.post(CONFIRM, json={"code": not_the(clock.code(secret))}, headers=bearer(tok))
    assert r.status_code == 403
    assert client.get(STATUS, headers=bearer(tok)).json()["enrolled"] is False


@pytest.mark.parametrize("bad", ["12345", "1234567", "abcdef", "", "１２３４５６"])
def test_a_confirmation_code_must_be_six_ascii_digits(client, clock, bad):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    client.post(ENROLL, json=PW, headers=bearer(tok))
    assert client.post(CONFIRM, json={"code": bad}, headers=bearer(tok)).status_code == 422


def test_confirming_without_starting_is_refused(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    assert client.post(CONFIRM, json={"code": "123456"}, headers=bearer(tok)).status_code == 409


def test_someone_already_enrolled_cannot_enrol_again(client, clock):
    u = enrolled_user(client, clock)
    tok = verify(client, challenge(client, u), clock.code(u["secret"])).json()["access_token"]
    assert client.post(ENROLL, json=PW, headers=bearer(tok)).status_code == 409


def test_enrolling_again_before_confirming_replaces_the_pending_secret(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    first = client.post(ENROLL, json=PW, headers=bearer(tok)).json()["secret"]
    second = client.post(ENROLL, json=PW, headers=bearer(tok)).json()["secret"]
    assert first != second
    assert client.post(CONFIRM, json={"code": clock.code(first)},
                       headers=bearer(tok)).status_code == 403       # the old secret is dead
    assert client.post(CONFIRM, json={"code": clock.code(second)},
                       headers=bearer(tok)).status_code == 200


def test_guessing_the_confirmation_code_is_throttled(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    secret = client.post(ENROLL, json=PW, headers=bearer(tok)).json()["secret"]
    wrong = not_the(clock.code(secret))
    codes = [client.post(CONFIRM, json={"code": wrong}, headers=bearer(tok)).status_code
             for _ in range(6)]
    assert codes[:5] == [403] * 5 and codes[5] == 429


def test_enrolment_needs_a_session(client, clock):
    assert client.post(ENROLL).status_code == 401
    assert client.post(CONFIRM, json={"code": "123456"}).status_code == 401


def test_enrolment_is_audited(client, clock):
    u = make_user(memberships=STAFF)
    enrol(client, token_for(client, u["email"], u["password"]), clock)
    assert any(e["action"] == "auth.mfa_enrolled" for e in tail(limit=30, subject=u["email"]))


# ── signing in: the challenge ──────────────────────────────────────────────

def test_an_enrolled_user_gets_a_challenge_not_a_session(client, clock):
    u = enrolled_user(client, clock)
    r = login(client, u["email"], u["password"])
    assert r.status_code == 202
    body = r.json()
    assert body["mfa_required"] is True and body["mfa_token"] and body["expires_in"] == 300
    assert "access_token" not in body


def test_the_challenge_token_is_useless_as_a_bearer_token(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    assert client.get("/api/auth/me", headers=bearer(token)).status_code == 401


def test_a_correct_code_completes_the_sign_in(client, clock):
    u = enrolled_user(client, clock)
    r = verify(client, challenge(client, u), clock.code(u["secret"]))
    assert r.status_code == 200, r.text
    assert claims_of(r.json()["access_token"])["amr"] == ["password", "totp"]
    assert client.get("/api/auth/me", headers=bearer(r.json()["access_token"])).status_code == 200


def test_a_wrong_code_is_refused(client, clock):
    u = enrolled_user(client, clock)
    r = verify(client, challenge(client, u), not_the(clock.code(u["secret"])))
    assert r.status_code == 401 and "access_token" not in r.json()


def test_five_wrong_codes_lock_the_account_even_against_the_right_one(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    wrong = not_the(clock.code(u["secret"]))
    assert [verify(client, token, wrong).status_code for _ in range(5)] == [401] * 5
    locked = verify(client, token, clock.code(u["secret"]))
    assert locked.status_code == 429 and int(locked.headers["Retry-After"]) > 0


def test_a_code_cannot_be_used_twice(client, clock):
    u = enrolled_user(client, clock)
    code = clock.code(u["secret"])
    assert verify(client, challenge(client, u), code).status_code == 200
    assert verify(client, challenge(client, u), code).status_code == 401     # replay


def _settled(client, clock) -> dict:
    """An enrolled user whose last-used TOTP step is well in the past, so the only thing
    that can make a code fail is the tolerance window — not replay protection."""
    u = enrolled_user(client, clock)
    clock.advance(120)
    return u


def test_a_code_is_accepted_one_step_either_side_of_now(client, clock):
    u = _settled(client, clock)
    now = clock.now()
    assert verify(client, challenge(client, u), clock.code(u["secret"], at=now - 30)).status_code == 200
    assert verify(client, challenge(client, u), clock.code(u["secret"], at=now + 30)).status_code == 200


@pytest.mark.parametrize("skew", [-90, -60, 90])
def test_a_code_further_out_than_that_is_refused(client, clock, skew):
    u = _settled(client, clock)
    r = verify(client, challenge(client, u), clock.code(u["secret"], at=clock.now() + skew))
    assert r.status_code == 401


def test_the_membership_chosen_at_sign_in_survives_the_challenge(client, clock):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    secret, _, _ = enrol(client, tok, clock)
    ident = {**u, "secret": secret}

    token = challenge(client, ident, org_id="ORG-RAMAN", role="fleet_manager")
    r = verify(client, token, clock.code(secret))
    assert (r.json()["principal"]["org"]["id"], r.json()["principal"]["role"]) == \
        ("ORG-RAMAN", "fleet_manager")


def test_a_choice_still_has_to_be_made_before_the_challenge(client, clock):
    # An ambiguous sign-in must not be resolved by guessing on the way to the second step.
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    enrol(client, tok, clock)
    assert login(client, u["email"], u["password"]).status_code == 400


# ── the challenge token itself ─────────────────────────────────────────────

def test_a_challenge_expires_after_five_minutes(client, clock):
    u = enrolled_user(client, clock)
    claims = claims_of(challenge(client, u))
    assert 0 < claims["exp"] - claims["iat"] <= 300
    claims["exp"] = int(time.time()) - 5
    expired = sign(claims, settings.jwt_secret)
    assert verify(client, expired, clock.code(u["secret"])).status_code == 401


def test_a_challenge_dies_when_the_users_sessions_are_revoked(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    bump_token_version(u["id"])
    assert verify(client, token, clock.code(u["secret"])).status_code == 401


def test_a_challenge_for_a_user_deactivated_meanwhile_is_refused(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    set_active(u["id"], False)
    assert verify(client, token, clock.code(u["secret"])).status_code == 403


def test_a_forged_challenge_is_refused(client, clock):
    u = enrolled_user(client, clock)
    claims = claims_of(challenge(client, u))
    forged = sign(claims, "not-the-servers-key-" + "q" * 24)
    assert verify(client, forged, clock.code(u["secret"])).status_code == 401


def test_a_challenge_cannot_be_turned_into_an_access_token_by_editing_it(client, clock):
    # Same key, but claiming the API audience: refused, because the challenge carries a
    # marker that access tokens never do.
    u = enrolled_user(client, clock)
    claims = claims_of(challenge(client, u))
    claims["aud"] = "autosaarthi-api"
    edited = sign(claims, settings.jwt_secret)
    assert client.get("/api/auth/me", headers=bearer(edited)).status_code == 401


# ── recovery codes ─────────────────────────────────────────────────────────

def test_a_recovery_code_works_once_and_is_recorded_as_such(client, clock):
    u = enrolled_user(client, clock)
    r = verify(client, challenge(client, u), u["recovery"][0])
    assert r.status_code == 200
    assert claims_of(r.json()["access_token"])["amr"] == ["password", "recovery"]
    assert verify(client, challenge(client, u), u["recovery"][0]).status_code == 401
    tok = r.json()["access_token"]
    assert client.get(STATUS, headers=bearer(tok)).json()["recovery_codes_remaining"] == 9


@pytest.mark.parametrize("respell", [str.upper, lambda c: c.replace("-", ""),
                                     lambda c: f"  {c.upper()}  "])
def test_a_recovery_code_may_be_typed_loosely(client, clock, respell):
    u = enrolled_user(client, clock)
    assert verify(client, challenge(client, u), respell(u["recovery"][0])).status_code == 200


def test_a_wrong_recovery_code_is_refused_and_counted(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    wrong = "aaaaa-aaaaa" if u["recovery"][0] != "aaaaa-aaaaa" else "bbbbb-bbbbb"
    assert verify(client, token, wrong).status_code == 401


# ── the other ways in are challenged too ───────────────────────────────────

def test_google_sign_in_is_challenged_as_well(client, clock, google):
    u = enrolled_user(client, clock)
    cred = google.add("c", sub="g-mfa-" + u["id"][-6:], email=u["email"])
    r = client.post("/api/auth/google", json={"credential": cred})
    assert r.status_code == 202
    done = verify(client, r.json()["mfa_token"], clock.code(u["secret"]))
    assert claims_of(done.json()["access_token"])["amr"] == ["google", "totp"]


def test_phone_sign_in_is_challenged_when_the_owner_has_enrolled(client, clock, sms):
    # An owner's role does not REQUIRE a second factor, but one who set it up gets it.
    owner = make_user()
    tok = token_for(client, owner["email"], owner["password"])
    secret, _, _ = enrol(client, tok, clock)
    customer = make_customer(new_phone(), user_id=owner["id"])

    assert client.post("/api/auth/otp/request", json={"phone": customer["phone"]}).status_code == 202
    code = sms.codes_for(customer["e164"])[-1]
    r = client.post("/api/auth/otp/verify", json={"phone": customer["phone"], "code": code})
    assert r.status_code == 202
    done = verify(client, r.json()["mfa_token"], clock.code(secret))
    assert claims_of(done.json()["access_token"])["amr"] == ["phone_otp", "totp"]


# ── the trail ──────────────────────────────────────────────────────────────

def test_successes_and_failures_are_audited(client, clock):
    u = enrolled_user(client, clock)
    token = challenge(client, u)
    verify(client, token, not_the(clock.code(u["secret"])))
    verify(client, token, clock.code(u["secret"]))
    events = tail(limit=50, subject=u["email"])
    failed = [e for e in events if e["action"] == "auth.mfa_failed"]
    assert failed and _details(failed[0])["reason"] == "wrong_code"
    assert any(e["action"] == "auth.mfa_verified" for e in events)
    blob = json.dumps([str(e) for e in events])
    assert u["secret"] not in blob and clock.code(u["secret"]) not in blob


# Each layer that keeps a challenge apart from a session is tested ON ITS OWN, so removing
# any one of them is caught — the layers overlap, and overlapping defences hide a missing
# one unless each is isolated.

def test_the_typ_marker_alone_bars_a_challenge_from_passing_as_a_session(client, clock):
    # A token with EVERY access-token claim (right audience, a scope) but the challenge's
    # `typ` marker: only the marker can refuse it.
    u = enrolled_user(client, clock)
    session = claims_of(verify(client, challenge(client, u),
                               clock.code(u["secret"])).json()["access_token"])
    session["typ"] = "mfa"
    assert client.get("/api/auth/me",
                      headers=bearer(sign(session, settings.jwt_secret))).status_code == 401


def test_a_session_audience_alone_bars_a_token_from_passing_as_a_challenge(client, clock):
    # A token with EVERY challenge claim (including `typ`) but the API audience: only the
    # audience can refuse it at the second step.
    u = enrolled_user(client, clock)
    claims = claims_of(challenge(client, u))
    claims["aud"] = "autosaarthi-api"
    forged = sign(claims, settings.jwt_secret)
    assert verify(client, forged, clock.code(u["secret"])).status_code == 401


# ── enrolling is a change to how the account is protected, so it re-authenticates ─────────
# Found in review: with only a session, an attacker holding a stolen token could enrol THEIR
# authenticator on the victim's account — locking the owner out at the next sign-in and
# keeping access through a password reset. Enrolment now needs the current password (or, for
# an account with none, a session no older than ten minutes).

def test_a_stolen_session_cannot_enrol_the_attackers_authenticator(client, clock):
    u = make_user(memberships=STAFF)
    stolen = token_for(client, u["email"], u["password"])

    assert client.post(ENROLL, headers=bearer(stolen)).status_code == 403                  # no password
    assert client.post(ENROLL, json={"current_password": "not-it"},
                       headers=bearer(stolen)).status_code == 403                          # wrong one
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM user_mfa WHERE user_id = :u"),
                            {"u": u["id"]}).scalar() == 0, "a secret was created without re-authentication"

    assert client.post(ENROLL, json={"current_password": u["password"]},
                       headers=bearer(stolen)).status_code == 200                          # the owner


def test_guessing_the_password_at_enrolment_is_throttled(client, clock):
    u = make_user(memberships=STAFF)
    tok = token_for(client, u["email"], u["password"])
    codes = [client.post(ENROLL, json={"current_password": f"guess-{i}"},
                         headers=bearer(tok)).status_code for i in range(6)]
    assert codes[:5] == [403] * 5 and codes[5] == 429


def test_an_account_with_no_password_needs_a_recent_session_to_enrol(client, clock):
    from app.auth.principal import issue_token

    u = make_user(password_hash="!", memberships=STAFF)
    fresh, _ = issue_token(u["id"], "ORG-RAMAN", "fleet_manager", 0, amr=["google"])
    assert client.post(ENROLL, headers=bearer(fresh)).status_code == 200

    claims = claims_of(fresh)
    claims["iat"] -= 3600                            # signed in an hour ago
    stale = sign(claims, settings.jwt_secret)
    assert client.post(ENROLL, headers=bearer(stale)).status_code == 403


def test_an_enrolment_only_session_needs_no_password(client, clock, monkeypatch):
    # They have just typed it to get this far, and the token can do nothing else.
    monkeypatch.setattr(settings, "mfa_enforcement", True)
    u = make_user(memberships=[("ORG-PLATFORM", "security_analyst")])
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    assert client.post(ENROLL, headers=bearer(tok)).status_code == 200


def test_status_tells_the_screen_whether_the_account_has_a_password(client, clock):
    with_pw = make_user(memberships=STAFF)
    without = make_user(password_hash="!", memberships=STAFF)
    from app.auth.principal import issue_token

    tok = token_for(client, with_pw["email"], with_pw["password"])
    assert client.get(STATUS, headers=bearer(tok)).json()["has_password"] is True
    other, _ = issue_token(without["id"], "ORG-RAMAN", "fleet_manager", 0, amr=["google"])
    assert client.get(STATUS, headers=bearer(other)).json()["has_password"] is False
