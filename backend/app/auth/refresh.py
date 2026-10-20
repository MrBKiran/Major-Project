"""
Refresh tokens: a short-lived access token (see principal.TOKEN_TTL_MINUTES) plus a
long-lived refresh token the browser cannot read, sitting in an httpOnly cookie.

A refresh token is a high-entropy random string; only a keyed hash of it — the same
HMAC-of-the-signing-key construction as the MFA secrets (see auth/mfa.py) — is ever
stored, so a database dump alone cannot produce one. Each token belongs to a FAMILY:
one sign-in, however many silent refreshes after it. It is single-use and rotates on
every call to `rotate()`; presenting one that was already rotated away or revoked is
reuse — a stolen cookie replayed after the legitimate client already moved past it —
and burns the whole family plus the user's token_version, so both sides have to sign
in again.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets
from collections.abc import Sequence
from dataclasses import dataclass

from fastapi import Response
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.auth.keys import signing_key
from app.config import settings

COOKIE_NAME = "refresh_token"
# Never sent to a route outside auth: nothing else has any business reading it.
COOKIE_PATH = "/api/auth"
# A token presented again this soon after it was rotated is a race, not a theft:
# two tabs, or a reload while a refresh was in flight, send the same cookie in
# the same second. The loser is told to retry — by then the shared cookie jar
# holds the winner's token — and nothing is burned. The cost is accepted: a
# replay inside this window goes undetected (it still gets no token), and one
# after it burns the family as before.
REUSE_GRACE_S = 20


def _hash(token: str) -> str:
    return hmac.new(signing_key().encode(), token.encode(), hashlib.sha256).hexdigest()


def _ttl() -> dt.timedelta:
    return dt.timedelta(days=settings.refresh_token_ttl_days)


def issue(conn: Connection, user_id: str, org_id: str, role: str, amr: Sequence[str],
         *, family_id: str | None = None) -> str:
    """A fresh refresh token, in a new family unless `family_id` continues one.

    Returns the raw token — the only time it exists outside this call's hash. The
    caller puts it in a cookie (`set_cookie`) and never stores it itself.
    """
    family_id = family_id or secrets.token_urlsafe(16)
    raw = secrets.token_urlsafe(32)
    now = dt.datetime.now(dt.timezone.utc)
    conn.execute(
        text("INSERT INTO refresh_tokens "
             "(family_id, user_id, org_id, role, amr, token_hash, issued_at, expires_at) "
             "VALUES (:f, :u, :o, :r, :a, :h, :now, :exp)"),
        {"f": family_id, "u": user_id, "o": org_id, "r": role, "a": ",".join(amr),
         "h": _hash(raw), "now": now, "exp": now + _ttl()},
    )
    return raw


class RefreshFailure(Exception):
    """`reason` is "invalid", "expired", "reused", or "raced"."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


@dataclass
class Rotated:
    raw_token: str
    user_id: str
    org_id: str
    role: str
    amr: tuple[str, ...]


def rotate(conn: Connection, raw_token: str) -> Rotated:
    """Consume `raw_token` and mint its replacement in the same family.

    Raises RefreshFailure("invalid") if the hash matches no live token;
    ("raced") if it was rotated within REUSE_GRACE_S — nothing is changed;
    ("reused") — after revoking the whole family and bumping the user's
    token_version — if it had already been rotated away earlier, or revoked;
    ("expired") if it is past its own ttl (also marked used, so it cannot be
    tried twice).
    """
    row = conn.execute(
        text("SELECT id, family_id, user_id, org_id, role, amr, expires_at, used_at, revoked_at "
             "FROM refresh_tokens WHERE token_hash = :h"),
        {"h": _hash(raw_token)},
    ).first()
    if row is None:
        raise RefreshFailure("invalid")

    now = dt.datetime.now(dt.timezone.utc)
    if (row.revoked_at is None and row.used_at is not None
            and now - row.used_at <= dt.timedelta(seconds=REUSE_GRACE_S)):
        raise RefreshFailure("raced")

    if row.used_at is not None or row.revoked_at is not None:
        revoke_family(conn, row.family_id)
        conn.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
                     {"u": row.user_id})
        raise RefreshFailure("reused")

    conn.execute(text("UPDATE refresh_tokens SET used_at = :now WHERE id = :id"),
                 {"now": now, "id": row.id})
    if row.expires_at < now:
        raise RefreshFailure("expired")

    amr = tuple(row.amr.split(","))
    new_raw = issue(conn, row.user_id, row.org_id, row.role, amr, family_id=row.family_id)
    return Rotated(raw_token=new_raw, user_id=row.user_id, org_id=row.org_id, role=row.role, amr=amr)


def revoke_family(conn: Connection, family_id: str) -> None:
    conn.execute(
        text("UPDATE refresh_tokens SET revoked_at = :now "
             "WHERE family_id = :f AND revoked_at IS NULL"),
        {"now": dt.datetime.now(dt.timezone.utc), "f": family_id},
    )


def revoke_all_for_user(conn: Connection, user_id: str) -> None:
    """Called everywhere `users.token_version` is bumped to end sessions: logout,
    an admin revoking another user's sessions, a password change, an MFA reset,
    deactivation. Without this a stolen access token would be dead on its next
    request, but its refresh cookie would happily mint a fresh one forever."""
    conn.execute(
        text("UPDATE refresh_tokens SET revoked_at = :now "
             "WHERE user_id = :u AND revoked_at IS NULL"),
        {"now": dt.datetime.now(dt.timezone.utc), "u": user_id},
    )


def set_cookie(response: Response, raw_token: str) -> None:
    response.set_cookie(
        COOKIE_NAME, raw_token, httponly=True, samesite="lax",
        # Not forced True in development: this app is also reached over plain HTTP
        # from a phone on the LAN, and a cookie marked Secure would simply never be
        # sent there. Production (HTTPS) gets the real protection.
        secure=settings.is_production, path=COOKIE_PATH,
        max_age=int(_ttl().total_seconds()),
    )


def clear_cookie(response: Response) -> None:
    response.delete_cookie(COOKIE_NAME, path=COOKIE_PATH)
