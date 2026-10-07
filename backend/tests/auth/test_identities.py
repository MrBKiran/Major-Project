"""
Phase 3 — external identities: "this Google account / this phone number is that user".

A `users` row is the person; an identity is one way of proving to be them. Keeping
them apart is what lets one person sign in by password, by Google and by phone
without three accounts, and lets any one of those be revoked on its own.

The invariant everything else relies on: a (provider, subject) pair belongs to at
most ONE user. If two accounts could claim the same Google `sub` or the same
number, signing in with it would be ambiguous — and an attacker who managed to
attach a victim's identifier to their own account would receive the victim's
sign-ins.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.db.models import Customer
from app.db.session import SessionLocal, engine

from .helpers import make_user


def _subject(prefix: str = "sub") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


# ── the table ──────────────────────────────────────────────────────────────

def test_the_identities_table_has_the_expected_shape(db_engine):
    with db_engine.connect() as c:
        cols = {r[0] for r in c.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'user_identities'"))}
    assert {"id", "user_id", "provider", "subject", "created_at", "last_used_at"} <= cols


def test_a_provider_subject_pair_cannot_belong_to_two_users(db_engine):
    a, b = make_user(), make_user()
    subject = _subject()
    insert = text("INSERT INTO user_identities (user_id, provider, subject, created_at) "
                  "VALUES (:u, 'google', :s, now())")
    with db_engine.begin() as c:
        c.execute(insert, {"u": a["id"], "s": subject})
    with pytest.raises(IntegrityError):
        with db_engine.begin() as c:
            c.execute(insert, {"u": b["id"], "s": subject})


# ── the helpers ────────────────────────────────────────────────────────────

def test_a_linked_identity_is_found_and_an_unknown_one_is_not():
    from app.auth.identities import find_user_id, link_identity

    u, subject = make_user(), _subject()
    with engine.begin() as c:
        link_identity(c, u["id"], "google", subject)
    with engine.connect() as c:
        assert find_user_id(c, "google", subject) == u["id"]
        assert find_user_id(c, "google", _subject("other")) is None


def test_the_provider_is_part_of_the_key():
    from app.auth.identities import find_user_id, link_identity

    u, subject = make_user(), _subject()
    with engine.begin() as c:
        link_identity(c, u["id"], "google", subject)
    with engine.connect() as c:
        assert find_user_id(c, "phone", subject) is None


def test_linking_the_same_identity_to_the_same_user_twice_is_harmless():
    from app.auth.identities import link_identity

    u, subject = make_user(), _subject()
    with engine.begin() as c:
        link_identity(c, u["id"], "google", subject)
        link_identity(c, u["id"], "google", subject)
    with engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM user_identities WHERE provider='google' "
                           "AND subject = :s"), {"s": subject}).scalar()
    assert n == 1


def test_linking_an_identity_that_belongs_to_someone_else_is_refused():
    from app.auth.identities import IdentityConflict, link_identity

    a, b, subject = make_user(), make_user(), _subject()
    with engine.begin() as c:
        link_identity(c, a["id"], "google", subject)
    with pytest.raises(IdentityConflict):
        with engine.begin() as c:
            link_identity(c, b["id"], "google", subject)
    with engine.connect() as c:                     # and it is still a's
        from app.auth.identities import find_user_id
        assert find_user_id(c, "google", subject) == a["id"]


def test_one_user_may_hold_identities_from_several_providers():
    from app.auth.identities import link_identity

    u = make_user()
    with engine.begin() as c:
        link_identity(c, u["id"], "google", _subject())
        link_identity(c, u["id"], "phone", "+91" + str(uuid.uuid4().int)[:10])
    with engine.connect() as c:
        n = c.execute(text("SELECT count(*) FROM user_identities WHERE user_id = :u"),
                      {"u": u["id"]}).scalar()
    assert n == 2


def test_an_unknown_provider_is_refused():
    from app.auth.identities import link_identity

    u = make_user()
    with pytest.raises(ValueError):
        with engine.begin() as c:
            link_identity(c, u["id"], "facebook", _subject())


def test_marking_an_identity_used_stamps_last_used_at():
    from app.auth.identities import link_identity, mark_used

    u, subject = make_user(), _subject()
    with engine.begin() as c:
        link_identity(c, u["id"], "google", subject)
    with engine.connect() as c:
        assert c.execute(text("SELECT last_used_at FROM user_identities WHERE subject = :s"),
                         {"s": subject}).scalar() is None
    with engine.begin() as c:
        mark_used(c, "google", subject)
    with engine.connect() as c:
        assert c.execute(text("SELECT last_used_at FROM user_identities WHERE subject = :s"),
                         {"s": subject}).scalar() is not None


# ── customers.phone_e164 ───────────────────────────────────────────────────

def _customer_phone_e164(customer_id: str):
    with engine.connect() as c:
        return c.execute(text("SELECT phone_e164 FROM customers WHERE id = :i"),
                         {"i": customer_id}).scalar()


def test_seeded_customers_carry_a_normalised_phone(db_engine):
    from app.auth.phone import normalize_phone

    with db_engine.connect() as c:
        rows = c.execute(text("SELECT phone, phone_e164 FROM customers "
                              "WHERE phone IS NOT NULL")).all()
    assert rows, "the seed has customers with phones"
    for raw, e164 in rows:
        assert e164 == normalize_phone(raw), f"{raw!r} -> {e164!r}"


def test_inserting_a_customer_normalises_its_phone():
    cid = "CUST-" + uuid.uuid4().hex[:8]
    with SessionLocal() as s:
        s.add(Customer(id=cid, name="Phone Test", phone="+91 98765 43210"))
        s.commit()
    assert _customer_phone_e164(cid) == "+919876543210"


def test_changing_a_customers_phone_renormalises_it():
    cid = "CUST-" + uuid.uuid4().hex[:8]
    with SessionLocal() as s:
        s.add(Customer(id=cid, name="Phone Test", phone="+91 98765 43210"))
        s.commit()
    with SessionLocal() as s:
        s.get(Customer, cid).phone = "09123456789"
        s.commit()
    assert _customer_phone_e164(cid) == "+919123456789"


def test_an_unusable_phone_leaves_the_normalised_column_empty():
    cid = "CUST-" + uuid.uuid4().hex[:8]
    with SessionLocal() as s:
        s.add(Customer(id=cid, name="Phone Test", phone="call reception"))
        s.commit()
    assert _customer_phone_e164(cid) is None


def test_clearing_a_phone_clears_the_normalised_column_too():
    cid = "CUST-" + uuid.uuid4().hex[:8]
    with SessionLocal() as s:
        s.add(Customer(id=cid, name="Phone Test", phone="+91 98765 43210"))
        s.commit()
    with SessionLocal() as s:
        s.get(Customer, cid).phone = None
        s.commit()
    assert _customer_phone_e164(cid) is None
