"""
Phase 6 — changing your own password.

Until now there was no way to: an account's password changed only by editing the
database. The endpoint has to do four things beyond storing a hash. It must ask for the
CURRENT password (a stolen session alone must not be enough to lock the owner out), throttle
wrong guesses at it, end every OTHER session (the reason people change a password is often
"someone else may have it"), and keep the caller signed in on a fresh token.
"""

from __future__ import annotations

import json

import pytest

from app.auth.audit import tail
from app.auth.principal import verify_password

from .helpers import bearer, claims_of, login, make_user, stored_hash, token_for

URL = "/api/auth/password/change"
NEW = "Correct-horse-battery-91"


def change(client, token, current, new=NEW):
    return client.post(URL, json={"current_password": current, "new_password": new},
                       headers=bearer(token))


# A note on status codes, because the front end depends on it: a wrong CURRENT password (or a
# wrong authenticator code on a signed-in route) is 403, never 401. The client treats any 401
# as "your session is gone" and signs the user out, so mistyping the current password on the
# change-password form must not do that. 401 is for a bad or missing SESSION credential.

# ── the happy path ─────────────────────────────────────────────────────────

def test_changing_the_password_takes_effect(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    assert change(client, tok, u["password"]).status_code == 200

    assert login(client, u["email"], NEW).status_code == 200
    assert login(client, u["email"], u["password"]).status_code == 401


def test_the_caller_stays_signed_in_on_a_fresh_token(client):
    u = make_user()
    old = token_for(client, u["email"], u["password"])
    r = change(client, old, u["password"])

    fresh = r.json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(fresh)).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(old)).status_code == 401   # the old one is dead


def test_the_fresh_token_keeps_the_session_membership_and_method(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    r = change(client, tok, u["password"])
    claims = claims_of(r.json()["access_token"])
    assert (claims["org"], claims["role"], claims["amr"]) == ("ORG-RAMAN", "fleet_manager", ["password"])


def test_every_other_session_is_ended(client):
    u = make_user()
    laptop = token_for(client, u["email"], u["password"])
    phone = token_for(client, u["email"], u["password"])
    change(client, laptop, u["password"])
    assert client.get("/api/auth/me", headers=bearer(phone)).status_code == 401


def test_the_new_hash_is_stored_at_the_current_cost_and_verifies(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    change(client, tok, u["password"])
    assert verify_password(NEW, stored_hash(u["id"]))


# ── refusing ───────────────────────────────────────────────────────────────

def test_a_wrong_current_password_changes_nothing(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    before = stored_hash(u["id"])
    r = change(client, tok, "not-my-password")
    assert r.status_code == 403
    assert stored_hash(u["id"]) == before
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 200   # session intact


def test_guessing_the_current_password_is_throttled(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    codes = [change(client, tok, f"guess-{i}").status_code for i in range(6)]
    assert codes[:5] == [403] * 5 and codes[5] == 429


@pytest.mark.parametrize("weak", ["short", "password123", "aaaaaaaaaaaa"])
def test_a_weak_new_password_is_refused_with_the_reasons(client, weak):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    before = stored_hash(u["id"])
    r = change(client, tok, u["password"], new=weak)
    assert r.status_code == 422
    assert r.json()["detail"]["reasons"], r.text
    assert stored_hash(u["id"]) == before


def test_the_new_password_may_not_be_the_current_one(client):
    u = make_user(password="Existing-passphrase-77")
    tok = token_for(client, u["email"], u["password"])
    assert change(client, tok, u["password"], new=u["password"]).status_code == 422


def test_an_oversized_password_is_rejected_before_any_hashing(client, pbkdf2_calls):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    pbkdf2_calls.clear()
    r = change(client, tok, u["password"], new="x" * 100_000)
    assert r.status_code == 422 and pbkdf2_calls == []


def test_an_account_without_a_password_has_nothing_to_change(client):
    # Signed in with Google or a phone code: there is no password to be the "current" one.
    from app.auth.principal import issue_token

    u = make_user(password_hash="!")
    tok, _ = issue_token(u["id"], "ORG-CUSTOMERS", "vehicle_owner", 0, amr=["google"])
    assert change(client, tok, "anything").status_code == 403


def test_it_needs_a_signed_in_user(client):
    r = client.post(URL, json={"current_password": "x", "new_password": NEW})
    assert r.status_code == 401


# ── the trail ──────────────────────────────────────────────────────────────

def test_the_change_is_audited_without_any_password(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    change(client, tok, u["password"])
    lines = [e for e in tail(limit=30, subject=u["email"]) if e["action"] == "auth.password_changed"]
    assert lines
    blob = json.dumps([str(e) for e in lines])
    assert u["password"] not in blob and NEW not in blob


def test_a_refused_change_is_audited_as_a_failure(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    change(client, tok, "wrong-guess-here")
    lines = [e for e in tail(limit=30, subject=u["email"]) if e["action"] == "auth.password_change_failed"]
    assert lines
