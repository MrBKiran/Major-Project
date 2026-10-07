"""Test helpers for the auth suite: build users, log in, build headers.

Users are created through the ORM with unique addresses so tests never depend on
each other's rows, and a password hash computed once per password — hashing is
deliberately slow, and every test making its own would multiply suite time for
no benefit.
"""

from __future__ import annotations

import functools
import hashlib
import random
import secrets
import uuid

import jwt
from sqlalchemy import text

from app.auth.phone import normalize_phone
from app.auth.principal import hash_password
from app.db.models import Customer, Membership, User
from app.db.session import SessionLocal, engine
from app.db.tenancy_seed import user_id_for

DEFAULT_PASSWORD = "autosaarthi"


@functools.lru_cache(maxsize=None)
def _hash(password: str) -> str:
    return hash_password(password)


def unique_email(prefix: str = "t") -> str:
    return f"{prefix}.{uuid.uuid4().hex[:8]}@test.example"


def make_user(
    *,
    email: str | None = None,
    memberships=(("ORG-CUSTOMERS", "vehicle_owner"),),
    password: str = DEFAULT_PASSWORD,
    active: bool = True,
    name: str = "Test User",
    password_hash: str | None = None,
) -> dict:
    """Insert a user and its memberships; returns {id, email, password}."""
    email = (email or unique_email()).lower()
    uid = user_id_for(email)
    with SessionLocal() as s:
        s.add(User(id=uid, email=email, full_name=name, is_active=active,
                   # `is not None`, not `or`: an empty string is a legitimate
                   # (unusable) hash for the tests that need one.
                   password_hash=_hash(password) if password_hash is None else password_hash))
        s.flush()
        for org, role in memberships:
            s.add(Membership(user_id=uid, org_id=org, role=role))
        s.commit()
    return {"id": uid, "email": email, "password": password}


def login(client, email: str, password: str = DEFAULT_PASSWORD, **extra):
    return client.post("/api/auth/login", json={"email": email, "password": password, **extra})


def token_for(client, email: str, password: str = DEFAULT_PASSWORD, **extra) -> str:
    r = login(client, email, password, **extra)
    assert r.status_code == 200, f"login for {email} failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── passwords ──────────────────────────────────────────────────────────────

def pbkdf2_hash(password: str, iterations: int) -> str:
    """A stored-format hash at an explicit cost, for legacy-hash scenarios."""
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    return f"pbkdf2_sha256${iterations}${salt.hex()}${digest.hex()}"


def stored_hash(user_id: str) -> str:
    with engine.connect() as c:
        return c.execute(text("SELECT password_hash FROM users WHERE id = :u"),
                         {"u": user_id}).scalar()


def set_hash(user_id: str, value: str) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE users SET password_hash = :h WHERE id = :u"),
                  {"h": value, "u": user_id})


# ── users / tokens ─────────────────────────────────────────────────────────

def bump_token_version(user_id: str) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
                  {"u": user_id})


def set_active(user_id: str, active: bool) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE users SET is_active = :a WHERE id = :u"),
                  {"a": active, "u": user_id})


def claims_of(token: str) -> dict:
    """A token's claims WITHOUT checking its signature — for building variants."""
    return jwt.decode(token, options={"verify_signature": False})


def sign(claims: dict, key: str, algorithm: str = "HS256") -> str:
    return jwt.encode(claims, key, algorithm=algorithm)


# ── phones / customers / one-time codes ────────────────────────────────────

def new_phone() -> str:
    """A formatted Indian mobile number that libphonenumber accepts, and nobody else has."""
    while True:
        digits = str(random.choice("6789")) + "".join(random.choices("0123456789", k=9))
        candidate = f"+91 {digits[:5]} {digits[5:]}"
        if normalize_phone(candidate):
            return candidate


def make_customer(phone: str | None, *, name: str = "Test Owner",
                  user_id: str | None = None, email: str | None = None) -> dict:
    """An owner record. Pass `new_phone()` for a fresh valid number, or None for none."""
    cid = "CUST-" + uuid.uuid4().hex[:8]
    with SessionLocal() as s:
        s.add(Customer(id=cid, name=name, phone=phone, email=email, user_id=user_id))
        s.commit()
    return {"id": cid, "phone": phone, "e164": normalize_phone(phone), "name": name}


def challenge_rows(e164: str) -> list:
    with engine.connect() as c:
        return c.execute(text(
            "SELECT id, phone_e164, code_hmac, attempts, eligible, consumed_at, expires_at "
            "FROM otp_challenges WHERE phone_e164 = :p ORDER BY id"), {"p": e164}).all()


def expire_challenges(e164: str) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE otp_challenges SET expires_at = now() - interval '1 minute' "
                       "WHERE phone_e164 = :p"), {"p": e164})


def customers_of(user_id: str) -> list[str]:
    with engine.connect() as c:
        return [r[0] for r in c.execute(
            text("SELECT id FROM customers WHERE user_id = :u ORDER BY id"), {"u": user_id})]
