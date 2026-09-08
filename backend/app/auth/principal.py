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
import os
import secrets
from dataclasses import dataclass, field

import jwt

from app.auth.policy import get_policy
from app.config import settings

ALGORITHM = "HS256"
TOKEN_TTL_MINUTES = 12 * 60

PBKDF2_ITERATIONS = 240_000


# ── passwords ──────────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        algo, iterations, salt_hex, digest_hex = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        expected = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), bytes.fromhex(salt_hex), int(iterations)
        )
    except (ValueError, TypeError):
        return False
    # Constant-time: a timing-variable comparison here leaks the digest.
    return hmac.compare_digest(expected.hex(), digest_hex)


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

def _secret() -> str:
    secret = getattr(settings, "jwt_secret", "") or os.environ.get("JWT_SECRET", "")
    if not secret:
        # Dev fallback only. Startup logs a warning (see app.main) so this can
        # never quietly become the production signing key.
        return "autosaarthi-dev-secret-change-me"
    return secret


def issue_token(user_id: str, org_id: str, role: str, token_version: int) -> tuple[str, int]:
    expires_in = TOKEN_TTL_MINUTES * 60
    now = dt.datetime.now(dt.timezone.utc)
    payload = {
        "sub": user_id,
        "org": org_id,
        "role": role,
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
    return jwt.encode(payload, _secret(), algorithm=ALGORITHM), expires_in


def decode_token(token: str) -> dict:
    return jwt.decode(token, _secret(), algorithms=[ALGORITHM])
