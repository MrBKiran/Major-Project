"""
A second factor: TOTP codes from an authenticator app (RFC 6238), with recovery codes.

The properties that make it worth having:

  * The secret is ENCRYPTED at rest. A database dump must not be enough to generate
    anyone's codes. The key is MFA_ENCRYPTION_KEY; without one (development only) it is
    derived from the JWT secret, which works but ties enrolled users to that value.
  * A code works ONCE. Accepting the same six digits twice inside the 30-second window
    lets anyone who sees a code — over a shoulder, in a phishing proxy — reuse it, so the
    last accepted step is recorded atomically and anything at or before it is a replay.
  * A little clock drift is tolerated (one step either side) and no more.
  * Guesses are limited (see ratelimit.MFA_*): a code is a million possibilities.
  * Recovery codes are single-use, high-entropy, and stored only as keyed hashes.

Enrolment is not in force until the user proves they can produce a code (`confirm`); a
pending enrolment changes nothing about how they sign in.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
import time

import pyotp
from cryptography.fernet import Fernet
from sqlalchemy import text

from app.auth.keys import signing_key
from app.config import settings

ISSUER = "AutoSaarthi"
STEP_S = 30
DRIFT_STEPS = 1
RECOVERY_CODE_COUNT = 10
# No 0/o/1/l/i: a code read off a screen and typed by hand must not be ambiguous.
_RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
_GENERATE_HINT = ('python -c "from cryptography.fernet import Fernet; '
                  'print(Fernet.generate_key().decode())"')


class MfaConfigurationError(RuntimeError):
    """The second-factor configuration cannot work; the app must not start on it."""


def now() -> float:
    """The clock TOTP is checked against. A seam, so tests can move time."""
    return time.time()


# ── keys and secrets at rest ───────────────────────────────────────────────

def _derive(label: bytes) -> bytes:
    return hmac.new(signing_key().encode(), label, hashlib.sha256).digest()


def _fernet() -> Fernet:
    configured = settings.mfa_encryption_key
    if configured:
        return Fernet(configured.encode())
    return Fernet(base64.urlsafe_b64encode(_derive(b"autosaarthi/mfa-secrets/v1")))


def encrypt_secret(secret: str) -> str:
    return _fernet().encrypt(secret.encode()).decode()


def decrypt_secret(token: str) -> str:
    return _fernet().decrypt(token.encode()).decode()


def validate_mfa_config() -> list[str]:
    """Startup check. Raises MfaConfigurationError if the app must not start."""
    key = settings.mfa_encryption_key
    if key:
        try:
            Fernet(key.encode())
        except (ValueError, TypeError):
            raise MfaConfigurationError(
                f"MFA_ENCRYPTION_KEY is not a valid Fernet key (urlsafe base64 of 32 bytes). "
                f"Generate one with: {_GENERATE_HINT}") from None
        return []
    if settings.is_production:
        raise MfaConfigurationError(
            f"MFA_ENCRYPTION_KEY is not set, and production will not run without one — "
            f"it protects every enrolled user's TOTP secret. Generate one with: {_GENERATE_HINT}")
    if settings.mfa_enforcement:
        return ["MFA_ENCRYPTION_KEY is not set: TOTP secrets are encrypted with a key derived "
                "from JWT_SECRET, so rotating JWT_SECRET would lock every enrolled user out. "
                "Set MFA_ENCRYPTION_KEY."]
    return []


# ── TOTP ───────────────────────────────────────────────────────────────────

def new_secret() -> str:
    return pyotp.random_base32()           # 160 bits


def provisioning_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name=ISSUER)


def _matching_step(secret: str, code: str) -> int | None:
    """The 30-second step `code` is valid for, within the drift window, or None."""
    totp = pyotp.TOTP(secret)
    current = int(now() // STEP_S)
    matched = None
    for step in range(current - DRIFT_STEPS, current + DRIFT_STEPS + 1):
        # Every step is compared, so the work does not reveal which one matched.
        if hmac.compare_digest(totp.at(step * STEP_S), code):
            matched = step
    return matched


def is_enrolled(conn, user_id: str) -> bool:
    return conn.execute(
        text("SELECT 1 FROM user_mfa WHERE user_id = :u AND confirmed_at IS NOT NULL"),
        {"u": user_id}).first() is not None


def begin_enrollment(conn, user_id: str, email: str) -> tuple[str, str] | None:
    """Start (or restart) enrolment. Returns (secret, otpauth_uri), or None if the user
    is already enrolled — to enrol again they must disable it first."""
    if is_enrolled(conn, user_id):
        return None
    secret = new_secret()
    conn.execute(
        text("INSERT INTO user_mfa (user_id, secret_enc, created_at) VALUES (:u, :s, now()) "
             "ON CONFLICT (user_id) DO UPDATE SET secret_enc = :s, created_at = now(), "
             "last_used_step = NULL WHERE user_mfa.confirmed_at IS NULL"),
        {"u": user_id, "s": encrypt_secret(secret)})
    return secret, provisioning_uri(secret, email)


def confirm_enrollment(conn, user_id: str, code: str) -> tuple[str, list[str] | None]:
    """Activate a pending enrolment. Returns ('ok', recovery_codes), ('no_pending', None)
    or ('wrong_code', None)."""
    row = conn.execute(
        text("SELECT secret_enc FROM user_mfa WHERE user_id = :u AND confirmed_at IS NULL"),
        {"u": user_id}).first()
    if row is None:
        return "no_pending", None
    step = _matching_step(decrypt_secret(row.secret_enc), code)
    if step is None:
        return "wrong_code", None
    conn.execute(
        text("UPDATE user_mfa SET confirmed_at = now(), last_used_step = :s "
             "WHERE user_id = :u AND confirmed_at IS NULL"), {"u": user_id, "s": step})
    return "ok", issue_recovery_codes(conn, user_id)


def check_totp(conn, user_id: str, code: str) -> bool:
    """Is `code` a fresh, valid code for this user? A code is accepted once."""
    row = conn.execute(
        text("SELECT secret_enc FROM user_mfa WHERE user_id = :u AND confirmed_at IS NOT NULL"),
        {"u": user_id}).first()
    if row is None:
        return False
    step = _matching_step(decrypt_secret(row.secret_enc), code)
    if step is None:
        return False
    # Atomic: whoever advances last_used_step first wins, so two requests carrying the
    # same code cannot both succeed.
    advanced = conn.execute(
        text("UPDATE user_mfa SET last_used_step = :s WHERE user_id = :u "
             "AND (last_used_step IS NULL OR last_used_step < :s) RETURNING 1"),
        {"u": user_id, "s": step}).first()
    return advanced is not None


# ── recovery codes ─────────────────────────────────────────────────────────

def _normalise_recovery(code: str) -> str:
    return "".join(code.split()).replace("-", "").lower()


def _recovery_mac(normalised: str) -> str:
    return hmac.new(_derive(b"autosaarthi/mfa-recovery/v1"), normalised.encode(),
                    hashlib.sha256).hexdigest()


def issue_recovery_codes(conn, user_id: str) -> list[str]:
    """Replace the user's recovery codes with ten new ones and return them — the only
    time the plaintext exists."""
    conn.execute(text("DELETE FROM mfa_recovery_codes WHERE user_id = :u"), {"u": user_id})
    codes: set[str] = set()
    while len(codes) < RECOVERY_CODE_COUNT:
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        codes.add(f"{raw[:5]}-{raw[5:]}")
    for code in codes:
        conn.execute(
            text("INSERT INTO mfa_recovery_codes (user_id, code_mac, created_at) "
                 "VALUES (:u, :m, now())"),
            {"u": user_id, "m": _recovery_mac(_normalise_recovery(code))})
    return sorted(codes)


def use_recovery_code(conn, user_id: str, code: str) -> bool:
    normalised = _normalise_recovery(code)
    if len(normalised) != 10 or not set(normalised) <= set(_RECOVERY_ALPHABET):
        return False
    used = conn.execute(
        text("UPDATE mfa_recovery_codes SET used_at = now() "
             "WHERE user_id = :u AND code_mac = :m AND used_at IS NULL RETURNING id"),
        {"u": user_id, "m": _recovery_mac(normalised)}).first()
    return used is not None


def recovery_remaining(conn, user_id: str) -> int:
    return conn.execute(
        text("SELECT count(*) FROM mfa_recovery_codes WHERE user_id = :u AND used_at IS NULL"),
        {"u": user_id}).scalar()


# ── removing it ────────────────────────────────────────────────────────────

def remove(conn, user_id: str) -> None:
    """Delete the user's second factor and its recovery codes."""
    conn.execute(text("DELETE FROM mfa_recovery_codes WHERE user_id = :u"), {"u": user_id})
    conn.execute(text("DELETE FROM user_mfa WHERE user_id = :u"), {"u": user_id})
