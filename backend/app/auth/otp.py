"""
One-time codes for phone sign-in.

Six digits is a million possibilities, so what protects a code is not its length
but everything around it: it lives five minutes, gets five guesses, works once, only
the newest one counts, and it is stored as a keyed hash so a database dump gives an
attacker nothing to grind offline.

A challenge row is written for EVERY request, including numbers that belong to no
one. Nothing is texted for those, but the row means a request costs the same and
leaves the same trace whether or not the number is real — and a `verify` for an
unknown number fails through the same path as a wrong code. Whether a number belongs
to a customer is precisely what a stranger would like to learn.

Which owner a number belongs to is decided by the customers table, and only by it.
`user_identities` records the binding for uniqueness and audit, but a number a
dealer has since changed stops working the moment the customer row changes.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets

from sqlalchemy import text

from app.auth.identities import IdentityConflict, find_user_id, link_identity, mark_used
from app.auth.keys import signing_key
from app.auth.sessions import usable_memberships
from app.config import settings

OWNER_ORG_KIND = "customer"
OWNER_ROLE = "vehicle_owner"
PHONE_EMAIL_DOMAIN = "phone.autosaarthi.invalid"   # RFC 2606: can never be a real mailbox


# ── codes ──────────────────────────────────────────────────────────────────

def generate_code() -> str:
    """Six digits from the OS CSPRNG, zero-padded (000123 is a valid code)."""
    return f"{secrets.randbelow(10**6):06d}"


def _mac_key() -> bytes:
    # Derived from the signing key with a label, so the OTP key is a different key
    # from the JWT one even though they share a root.
    return hmac.new(signing_key().encode(), b"autosaarthi/otp/v1", hashlib.sha256).digest()


def code_mac(phone_e164: str, code: str) -> str:
    """Keyed hash of a code, BOUND to the number: a hash lifted from one row is
    useless for any other number, and useless to grind without the key."""
    return hmac.new(_mac_key(), f"{phone_e164}|{code}".encode(), hashlib.sha256).hexdigest()


# ── who a number belongs to ────────────────────────────────────────────────

def _resolve(conn, phone: str):
    """Read-only: (user_row | None, customer_rows, reason | None).

    reason None with a user: sign that user in. reason None without one: nobody has
    an account for this number yet, and one will be created. Any reason: refuse.
    """
    customers = conn.execute(
        text("SELECT id, name, user_id FROM customers WHERE phone_e164 = :p ORDER BY id"),
        {"p": phone}).all()
    if not customers:
        return None, customers, "not_registered"

    linked = {c.user_id for c in customers if c.user_id}
    if len(linked) > 1:
        return None, customers, "ambiguous_identity"     # an administrator must decide
    bound_to = find_user_id(conn, "phone", phone)

    if not linked:
        if bound_to is not None:                         # the number is bound to someone
            return None, customers, "identity_conflict"  # the customer rows no longer say so
        return None, customers, None
    (user_id,) = linked
    if bound_to not in (None, user_id):
        return None, customers, "identity_conflict"

    user = conn.execute(
        text("SELECT id, email, full_name, is_active, token_version FROM users WHERE id = :u"),
        {"u": user_id}).first()
    if user is None:
        return None, customers, "not_registered"
    if not user.is_active:
        return user, customers, "deactivated"
    memberships = conn.execute(
        text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
             "JOIN organizations o ON o.id = m.org_id WHERE m.user_id = :u"),
        {"u": user.id}).all()
    if not usable_memberships(memberships, "phone_otp"):
        return user, customers, "method_not_allowed"
    return user, customers, None


def _provision_owner(conn, phone: str, customers):
    """Create the account for an owner who has never signed in. None if it cannot be."""
    org_id = conn.execute(text("SELECT id FROM organizations WHERE kind = :k ORDER BY id LIMIT 1"),
                          {"k": OWNER_ORG_KIND}).scalar()
    if org_id is None:
        return None
    user_id = "USR-ph" + hashlib.sha1(phone.encode()).hexdigest()[:10]
    user = conn.execute(
        text("INSERT INTO users (id, email, password_hash, full_name, is_active, token_version, "
             "created_at) VALUES (:id, :email, '!', :name, true, 0, now()) "
             "ON CONFLICT DO NOTHING "
             "RETURNING id, email, full_name, is_active, token_version"),
        {"id": user_id, "email": f"p{phone.lstrip('+')}@{PHONE_EMAIL_DOMAIN}",
         "name": customers[0].name},
    ).first()
    if user is None:
        return None
    conn.execute(text("INSERT INTO memberships (user_id, org_id, role) VALUES (:u, :o, :r)"),
                 {"u": user.id, "o": org_id, "r": OWNER_ROLE})
    return user


# ── requesting ─────────────────────────────────────────────────────────────

def start_challenge(conn, phone: str, ip: str | None) -> str | None:
    """Record a challenge. Returns the code to text, or None if nothing should be sent.

    A row is written either way (see the module docstring).
    """
    _, _, reason = _resolve(conn, phone)
    eligible = reason is None
    code = generate_code()
    conn.execute(
        text("INSERT INTO otp_challenges (phone_e164, code_hmac, created_at, expires_at, "
             "attempts, eligible, requested_ip) "
             "VALUES (:p, :h, now(), now() + make_interval(secs => :ttl), 0, :e, :ip)"),
        {"p": phone, "h": code_mac(phone, code), "ttl": settings.otp_ttl_s,
         "e": eligible, "ip": ip},
    )
    # Housekeeping: a day is long enough to investigate abuse, short enough that the
    # table does not grow without bound.
    conn.execute(text("DELETE FROM otp_challenges WHERE expires_at < now() - interval '1 day'"))
    return code if eligible else None


# ── verifying ──────────────────────────────────────────────────────────────

def verify_code(conn, phone: str, code: str) -> tuple[bool, str]:
    """Check a code against the newest challenge for this number.

    Returns (ok, reason). Every failure is a refusal; the reason is for the audit log
    and never reaches the caller. A wrong guess spends one of the challenge's attempts
    — durably, so the caller must commit even when this returns False.
    """
    challenge = conn.execute(
        text("SELECT id, code_hmac, eligible, (expires_at <= now()) AS expired "
             "FROM otp_challenges WHERE phone_e164 = :p AND consumed_at IS NULL "
             "ORDER BY id DESC LIMIT 1"), {"p": phone}).first()
    if challenge is None:
        return False, "no_challenge"
    if challenge.expired:
        return False, "expired"

    # Counted before the comparison and in one statement, so concurrent guesses
    # cannot each see "attempts < max" and all get through.
    spent = conn.execute(
        text("UPDATE otp_challenges SET attempts = attempts + 1 "
             "WHERE id = :i AND attempts < :max AND consumed_at IS NULL RETURNING attempts"),
        {"i": challenge.id, "max": settings.otp_max_attempts}).first()
    if spent is None:
        return False, "attempts_exhausted"

    if not hmac.compare_digest(code_mac(phone, code), challenge.code_hmac):
        return False, "wrong_code"
    if not challenge.eligible:
        return False, "ineligible"

    # Single use: whoever flips consumed_at first wins; a double-submit loses.
    used = conn.execute(
        text("UPDATE otp_challenges SET consumed_at = now() "
             "WHERE id = :i AND consumed_at IS NULL RETURNING id"),
        {"i": challenge.id}).first()
    if used is None:
        return False, "already_used"
    return True, "ok"


def complete_sign_in(conn, phone: str):
    """After a correct code: the user to sign in, creating their account if this is the
    first time. Returns (user | None, reason | None); a reason means refuse."""
    user, customers, reason = _resolve(conn, phone)
    if reason is not None:
        return user, reason
    if user is None:
        user = _provision_owner(conn, phone, customers)
        if user is None:
            return None, "cannot_provision"

    try:
        link_identity(conn, user.id, "phone", phone)
    except IdentityConflict:
        return None, "identity_conflict"
    # Same number, same person: owner records sharing it that have no account yet
    # belong to this one.
    conn.execute(text("UPDATE customers SET user_id = :u WHERE phone_e164 = :p AND user_id IS NULL"),
                 {"u": user.id, "p": phone})
    mark_used(conn, "phone", phone)
    return user, None
