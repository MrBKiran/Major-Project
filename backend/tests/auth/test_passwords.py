"""
Phase 2 — password hashing, and the login path around it.

Three things were wrong:

  * Login did no hashing at all for an address with no account (~0 ms) and a full
    PBKDF2 for one that had (~200 ms). Identical error text does not help when the
    response time says "this person is a customer" — and the code comment claimed
    both paths did "the same work". The tests below count derivations instead of
    timing them: wall-clock assertions are flaky, and the derivation count is the
    property that actually closes the oracle.
  * The cost factor was 240k iterations against OWASP's 600k for PBKDF2-SHA256,
    with no way to move existing accounts forward.
  * Every seeded account shared one hash, so anyone who could read the table could
    see they all had the same password.
"""

from __future__ import annotations

import hashlib

import pytest
from sqlalchemy import text

from app import api_auth
from app.auth import principal
from app.config import settings
from app.db.tenancy_seed import USERS

from .helpers import login, make_user, pbkdf2_hash, set_hash, stored_hash, unique_email


# ── the hash itself ────────────────────────────────────────────────────────

def test_production_hash_cost_meets_the_owasp_minimum(production_iterations):
    assert production_iterations >= 600_000


def test_hashes_are_salted_and_verify_only_the_right_password():
    a, b = principal.hash_password("correct horse"), principal.hash_password("correct horse")
    assert a != b
    assert principal.verify_password("correct horse", a)
    assert not principal.verify_password("battery staple", a)


@pytest.mark.parametrize("stored", [
    "", "!", "plaintext-password", "md5$1000$00$00", "pbkdf2_sha256$abc$00$00",
    "pbkdf2_sha256$0$00$00", "pbkdf2_sha256$-5$00$00", "pbkdf2_sha256$1000$zz$00",
    "pbkdf2_sha256$1000$00",
], ids=["empty", "bang", "plaintext", "wrong-algo", "non-numeric-cost", "zero-cost",
        "negative-cost", "non-hex-salt", "too-few-fields"])
def test_a_malformed_stored_hash_never_verifies(stored):
    assert principal.verify_password("autosaarthi", stored) is False


def test_an_absurd_stored_iteration_count_is_refused_not_computed(monkeypatch):
    # A row edited to a huge count would otherwise hang that account's login (and
    # a worker with it) for hours. hashlib is stubbed so this fails fast, not hangs,
    # if the guard is missing.
    seen: list[int] = []

    def stub(name, password, salt, iterations, *a, **k):
        seen.append(iterations)
        return b"\x00" * 32

    monkeypatch.setattr(hashlib, "pbkdf2_hmac", stub)
    assert principal.verify_password("pw", "pbkdf2_sha256$2000000000$00$" + "00" * 32) is False
    assert 2_000_000_000 not in seen


def test_needs_rehash_flags_only_hashes_cheaper_than_the_current_cost(monkeypatch):
    monkeypatch.setattr(principal, "PBKDF2_ITERATIONS", 2_000)
    assert principal.needs_rehash(pbkdf2_hash("pw", 1_000)) is True
    assert principal.needs_rehash(pbkdf2_hash("pw", 2_000)) is False
    assert principal.needs_rehash(pbkdf2_hash("pw", 5_000)) is False    # never downgraded


@pytest.mark.parametrize("stored", ["", "garbage", "md5$1$aa$bb", "pbkdf2_sha256$x$aa$bb"])
def test_needs_rehash_treats_an_unusable_hash_as_needing_replacement(stored):
    assert principal.needs_rehash(stored) is True


# ── the login path does the same work whatever the outcome ─────────────────

def test_an_unknown_address_costs_one_derivation_like_a_wrong_password(client, pbkdf2_calls):
    pbkdf2_calls.clear()
    r = login(client, unique_email("nobody"), "some-password")
    assert r.status_code == 401
    assert len(pbkdf2_calls) == 1, f"expected the same work as a real check, saw {pbkdf2_calls}"


def test_a_wrong_password_costs_one_derivation(client, pbkdf2_calls):
    u = make_user()
    pbkdf2_calls.clear()
    assert login(client, u["email"], "wrong-password").status_code == 401
    assert len(pbkdf2_calls) == 1


@pytest.mark.parametrize("stored", ["!", "", "not-a-hash"], ids=["locked", "empty", "garbage"])
def test_an_account_with_an_unusable_hash_costs_the_same_work_too(client, pbkdf2_calls, stored):
    # e.g. an account created without a password: distinguishable by timing from
    # a real one if it returns early, and so an enumerator for exactly those users.
    u = make_user(password_hash=stored)
    pbkdf2_calls.clear()
    assert login(client, u["email"], "anything").status_code == 401
    assert len(pbkdf2_calls) == 1


def test_unknown_and_wrong_password_answers_are_indistinguishable(client):
    real = make_user()
    a = login(client, real["email"], "wrong-password")
    b = login(client, unique_email("ghost"), "wrong-password")
    assert (a.status_code, a.json()) == (b.status_code, b.json())
    assert a.status_code == 401 and a.json() == {"detail": "invalid credentials"}


def test_a_deactivated_account_is_only_revealed_once_the_password_checks_out(client):
    u = make_user(active=False)
    assert login(client, u["email"], "wrong-password").status_code == 401
    assert login(client, u["email"], u["password"]).status_code == 403


def test_an_oversized_password_is_rejected_before_any_hashing(client, pbkdf2_calls):
    pbkdf2_calls.clear()
    r = login(client, unique_email("big"), "p" * 100_000)
    assert r.status_code == 422
    assert pbkdf2_calls == []


# ── moving existing accounts to the current cost ───────────────────────────

def test_a_successful_login_upgrades_a_cheaper_stored_hash(client, monkeypatch):
    monkeypatch.setattr(principal, "PBKDF2_ITERATIONS", 2_000)
    legacy = pbkdf2_hash("autosaarthi", 1_000)
    u = make_user(password_hash=legacy)

    assert login(client, u["email"], u["password"]).status_code == 200
    upgraded = stored_hash(u["id"])
    assert upgraded != legacy and upgraded.startswith("pbkdf2_sha256$2000$")
    assert login(client, u["email"], u["password"]).status_code == 200   # still works


def test_a_failed_login_never_rewrites_the_stored_hash(client, monkeypatch):
    monkeypatch.setattr(principal, "PBKDF2_ITERATIONS", 2_000)
    legacy = pbkdf2_hash("autosaarthi", 1_000)
    u = make_user(password_hash=legacy)
    assert login(client, u["email"], "wrong-password").status_code == 401
    assert stored_hash(u["id"]) == legacy


def test_a_hash_already_at_the_current_cost_is_left_alone(client):
    u = make_user()
    before = stored_hash(u["id"])
    assert login(client, u["email"], u["password"]).status_code == 200
    assert stored_hash(u["id"]) == before


def test_the_upgrade_never_overwrites_a_password_changed_in_the_meantime(client, monkeypatch):
    # Login verifies the OLD password, then a reset lands, then the upgrade runs.
    # A blind UPDATE would write the old password's hash over the reset and quietly
    # resurrect it — so the upgrade has to be conditional on the hash being unchanged.
    monkeypatch.setattr(principal, "PBKDF2_ITERATIONS", 2_000)
    u = make_user(password_hash=pbkdf2_hash("autosaarthi", 1_000))
    replaced = pbkdf2_hash("changed-in-the-meantime", 1_000)
    real_verify = api_auth.verify_password

    def verify_then_lose_the_race(password, stored):
        ok = real_verify(password, stored)
        set_hash(u["id"], replaced)
        return ok

    monkeypatch.setattr(api_auth, "verify_password", verify_then_lose_the_race)
    assert login(client, u["email"], u["password"]).status_code == 200
    assert stored_hash(u["id"]) == replaced


# ── the demo seed ──────────────────────────────────────────────────────────

def test_every_seeded_account_has_its_own_hash(db_engine):
    emails = sorted({e.lower() for e, *_ in USERS})
    with db_engine.connect() as c:
        hashes = [r[0] for r in c.execute(
            text("SELECT password_hash FROM users WHERE email = ANY(:e)"), {"e": emails})]
    assert len(hashes) == len(emails)
    assert len(set(hashes)) == len(hashes), "seeded accounts share password hashes"


def test_the_demo_seed_refuses_to_run_in_production(monkeypatch):
    # It creates a platform_admin with a password printed in the README.
    from app.db.tenancy_seed import seed_tenancy

    monkeypatch.setattr(settings, "environment", "production")
    with pytest.raises(RuntimeError, match="production"):
        seed_tenancy()
