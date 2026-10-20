"""
Principal — who is making this request, and what may they see.

A Principal is resolved once per request from a bearer token and then carried
everywhere: into endpoints, into scope predicates, and into agent runs. Nothing
downstream re-derives authorisation from the raw token.

Password hashing is PBKDF2-HMAC-SHA256 from the standard library. No plaintext
password is ever stored, logged, or returned.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import hmac
import secrets
from dataclasses import dataclass, field

import jwt

from app.auth.keys import signing_key
from app.auth.policy import LOGIN_METHODS, get_policy

ALGORITHM = "HS256"
# Short-lived on purpose (Phase 7): the refresh cookie (auth/refresh.py), never
# readable from JavaScript, is what keeps a session alive beyond this — not a
# bearer token sitting in localStorage for half a day.
TOKEN_TTL_MINUTES = 15
# What a token may be used for. "full" is an ordinary session. "mfa_enroll" is issued to
# a user whose role requires a second factor they have not set up: it can enrol and
# nothing else, and is short-lived because it is a half-signed-in state.
SCOPE_TTL_MINUTES = {"full": TOKEN_TTL_MINUTES, "mfa_enroll": 15}

# Who issued a token and who it is for. Both are required and checked on decode,
# so a token minted for some other service (or by one that happens to share the
# key) is refused here even though its signature verifies.
ISSUER = "autosaarthi"
AUDIENCE = "autosaarthi-api"
# A second-factor CHALLENGE is signed for a different audience, so it can never be
# accepted as an access token however it leaks: "you have proved who you are, now prove
# it again" is not a credential for anything else.
MFA_AUDIENCE = "autosaarthi-mfa"
MFA_CHALLENGE_TTL_S = 300
# A token missing any of these is refused. `exp` matters most: PyJWT only checks
# expiry when the claim is present, so without this a token with none is valid
# forever.
REQUIRED_CLAIMS = ["exp", "iat", "sub", "org", "role", "tv", "jti", "iss", "aud", "amr", "scp"]

# OWASP's 2023 floor for PBKDF2-HMAC-SHA256. Existing hashes made at a lower cost
# keep working and are upgraded on the holder's next successful login.
PBKDF2_ITERATIONS = 600_000
# Sanity ceiling on a STORED count. Nothing here writes a number this high; one
# appearing in a row would hang that account's login (and a worker) for hours.
MAX_PBKDF2_ITERATIONS = 5_000_000
# Bounds the work a single login request can demand. Generous — a passphrase, or a
# password-manager value, is nowhere near it.
MAX_PASSWORD_LENGTH = 256


# ── passwords ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def _parse_hash(stored: str) -> tuple[int, bytes, bytes] | None:
    """(iterations, salt, digest) of a stored hash, or None if it is unusable."""
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return None
        count = int(iterations)
        salt, digest = bytes.fromhex(salt_hex), bytes.fromhex(digest_hex)
    except (ValueError, TypeError, AttributeError):
        return None
    if not 1 <= count <= MAX_PBKDF2_ITERATIONS or not salt or not digest:
        return None
    return count, salt, digest


# Any fixed value: the result of burn_password_work is thrown away.
_BURN_SALT = b"autosaarthi-timing-equaliser"


def burn_password_work(password: str) -> None:
    """Spend the CPU a real verification costs, and discard the answer.

    Called wherever a login would otherwise skip the hash — no such account, or an
    account whose stored hash is unusable. Without it those paths return in
    microseconds while a real check takes ~half a second, and the difference is an
    oracle for "does this address have an account".
    """
    hashlib.pbkdf2_hmac("sha256", password.encode(), _BURN_SALT, PBKDF2_ITERATIONS)


def verify_password(password: str, stored: str) -> bool:
    parsed = _parse_hash(stored)
    if parsed is None:
        burn_password_work(password)
        return False
    iterations, salt, digest = parsed
    expected = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, iterations)
    # Constant-time: a timing-variable comparison here leaks the digest.
    return hmac.compare_digest(expected, digest)


def has_usable_password(stored: str) -> bool:
    """False for an account that has no password — Google or phone sign-in only."""
    return _parse_hash(stored) is not None


def needs_rehash(stored: str) -> bool:
    """True if this hash should be replaced: cheaper than today's cost, or unusable.
    A hash that is already more expensive is never downgraded."""
    parsed = _parse_hash(stored)
    return parsed is None or parsed[0] < PBKDF2_ITERATIONS


# ── principal ──────────────────────────────────────────────────────────────

@dataclass
class Principal:
    user_id: str
    email: str
    full_name: str
    org_id: str
    org_name: str
    org_kind: str
    role: str
    # How this session was authenticated (RFC 8176 "amr"): the sign-in method, then
    # any second factor — e.g. ("password",), ("phone_otp",), ("google", "totp").
    # /switch consults it so a session cannot be moved into a role that forbids
    # the way it was proven.
    amr: tuple[str, ...] = ()
    # "full" or "mfa_enroll" — see SCOPE_TTL_MINUTES.
    session_scope: str = "full"
    # The token_version this request was AUTHENTICATED with, and when the token was issued.
    # Anything that mints a replacement token must stamp the former on it, not re-read the
    # column: a "log out everywhere" that lands between authentication and minting would
    # otherwise be undone by the new token. The latter backs "recent sign-in" checks.
    token_version: int = 0
    issued_at: int = 0
    # Resolved lazily from the org kind — see auth/scope.py.
    brands: list[str] = field(default_factory=list)
    center_ids: list[str] = field(default_factory=list)
    customer_ids: list[str] = field(default_factory=list)
    fleet_vins: list[str] = field(default_factory=list)

    # ---- authorisation -------------------------------------------------

    def can(self, permission: str) -> bool:
        spec = get_policy().role(self.role)
        return bool(spec and spec.allows(permission))

    def require(self, permission: str) -> None:
        if not self.can(permission):
            from fastapi import HTTPException

            raise HTTPException(
                403,
                f"role '{self.role}' lacks '{permission}'",
            )

    @property
    def login_method(self) -> str | None:
        """The primary sign-in method — the first entry of `amr` that names one."""
        return next((a for a in self.amr if a in LOGIN_METHODS), None)

    @property
    def second_factor_done(self) -> bool:
        """Did this session pass a second factor (an authenticator code or a recovery code)?"""
        return any(a in ("totp", "recovery") for a in self.amr)

    @property
    def scope_kind(self) -> str:
        return get_policy().scope_kind(self.org_kind)

    @property
    def is_unrestricted(self) -> bool:
        return self.scope_kind == "all"

    def redact(self, row: dict) -> dict:
        """Blank fields this principal has no permission to see.

        Row-level scoping decides *which* records; this decides which columns
        within them. An OEM sees the vehicle and not its owner.
        """
        if self.can("customer_pii:read"):
            return row
        fields, replacement = get_policy().redacted_fields("customer_pii:read")
        return {k: (replacement if k in fields and row.get(k) is not None else v)
                for k, v in row.items()}

    def describe(self) -> dict:
        return {
            "user_id": self.user_id, "email": self.email, "full_name": self.full_name,
            "org": {"id": self.org_id, "name": self.org_name, "kind": self.org_kind},
            "role": self.role,
            "scope_kind": self.scope_kind,
            "permissions": sorted(
                p for p in get_policy().permissions if self.can(p)
            ),
        }


# ── tokens ─────────────────────────────────────────────────────────────────

def issue_token(user_id: str, org_id: str, role: str, token_version: int,
                *, amr: list[str] | tuple[str, ...], scope: str = "full") -> tuple[str, int]:
    """`amr` has no default on purpose: a caller that forgets it would silently
    claim the session was authenticated by password."""
    expires_in = SCOPE_TTL_MINUTES[scope] * 60
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": user_id,
        "org": org_id,
        "role": role,
        "amr": list(amr),
        "scp": scope,
        "tv": token_version,   # checked against users.token_version on every request
        # RFC 7519 jti. Not checked anywhere (revocation here is deliberately
        # all-or-nothing per user via `tv`, not per-session) — its job is
        # making every issued token unique. Without it, two logins for the
        # same user/org/role/version within the same second produce a
        # byte-for-bit identical token (iat/exp only carry second precision),
        # which is fine functionally but makes "two sessions" indistinguishable
        # in logs and audit output.
        "jti": secrets.token_urlsafe(16),
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=expires_in)).timestamp()),
    }
    return jwt.encode(payload, signing_key(), algorithm=ALGORITHM), expires_in


def decode_token(token: str) -> dict:
    claims = jwt.decode(
        token, signing_key(),
        algorithms=[ALGORITHM],          # pinned: never trust the token's own `alg`
        audience=AUDIENCE, issuer=ISSUER,
        options={"require": REQUIRED_CLAIMS},
    )
    if "typ" in claims:                  # a challenge (or anything else) dressed as a session
        raise jwt.InvalidTokenError("not an access token")
    return claims


def issue_mfa_challenge(user_id: str, org_id: str, role: str, token_version: int,
                        *, amr: list[str] | tuple[str, ...]) -> tuple[str, int]:
    """A short-lived token meaning "this user passed the first step, as this membership".

    Bound to the membership chosen at the first step and to the user's token_version, so
    revoking their sessions also voids any challenge in flight.
    """
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "iss": ISSUER, "aud": MFA_AUDIENCE, "typ": "mfa",
        "sub": user_id, "org": org_id, "role": role, "tv": token_version, "amr": list(amr),
        "jti": secrets.token_urlsafe(16),
        "iat": int(now.timestamp()),
        "exp": int((now + dt.timedelta(seconds=MFA_CHALLENGE_TTL_S)).timestamp()),
    }
    return jwt.encode(payload, signing_key(), algorithm=ALGORITHM), MFA_CHALLENGE_TTL_S


def decode_mfa_challenge(token: str) -> dict:
    claims = jwt.decode(
        token, signing_key(), algorithms=[ALGORITHM],
        audience=MFA_AUDIENCE, issuer=ISSUER,
        options={"require": ["exp", "iat", "sub", "org", "role", "tv", "amr", "jti", "typ"]},
    )
    if claims["typ"] != "mfa":
        raise jwt.InvalidTokenError("not a second-factor challenge")
    return claims
