"""FastAPI dependencies: authenticate, hydrate scope, enforce permissions."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from app.auth.principal import Principal, decode_token
from app.auth.ratelimit import check_principal
from app.auth.scope import hydrate
from app.db.session import engine
from app.observability import principal_var

bearer = HTTPBearer(auto_error=False)

_PRINCIPAL_SQL = text("""
    SELECT u.id, u.email, u.full_name, u.is_active, u.token_version,
           o.id AS org_id, o.name AS org_name, o.kind AS org_kind, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    JOIN organizations o ON o.id = m.org_id
    WHERE u.id = :uid AND m.org_id = :oid AND m.role = :role
""")


async def current_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Principal:
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    try:
        claims = decode_token(creds.credentials)
    except Exception:  # noqa: BLE001 — every decode failure is the same 401
        raise HTTPException(401, "invalid or expired token") from None

    with engine.connect() as conn:
        row = conn.execute(_PRINCIPAL_SQL, {
            "uid": claims.get("sub"), "oid": claims.get("org"), "role": claims.get("role"),
        }).first()

    # The membership is re-checked on every request rather than trusted from
    # the token. Revoking a role has to take effect immediately, not whenever
    # the holder's token happens to expire.
    if row is None:
        raise HTTPException(403, "membership no longer valid")
    if not row.is_active:
        raise HTTPException(403, "user is deactivated")
    # A revoked token: someone logged out everywhere, or an admin forced it
    # after a compromise, and this token was minted before that happened.
    # Checked against the live DB value, not anything cached in the token
    # itself — that is the entire point of a revocation mechanism.
    if claims.get("tv") != row.token_version:
        raise HTTPException(401, "token has been revoked")

    allowed, retry_after = check_principal(row.id)
    if not allowed:
        raise HTTPException(429, f"rate limit exceeded, retry in {retry_after}s",
                             headers={"Retry-After": str(retry_after)})

    # Every log line for the rest of this request now carries who made it —
    # set here rather than in the middleware, because the middleware runs
    # before auth resolves and would only ever see the placeholder "-".
    principal_var.set(f"{row.email}:{row.role}")

    return hydrate(Principal(
        user_id=row.id, email=row.email, full_name=row.full_name,
        org_id=row.org_id, org_name=row.org_name, org_kind=row.org_kind, role=row.role,
    ))


def requires(permission: str):
    """Route guard: `Depends(requires("quality:read"))`."""

    async def _guard(principal: Principal = Depends(current_principal)) -> Principal:
        principal.require(permission)
        return principal

    return _guard
