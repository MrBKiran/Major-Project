"""FastAPI dependencies: authenticate, hydrate scope, enforce permissions."""

from __future__ import annotations

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import text

from app.auth.policy import get_policy
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
    """An ordinary, fully signed-in session — the default for every route."""
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    return resolve_principal(creds.credentials)


async def enrolling_principal(
    creds: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> Principal:
    """A full session OR an enrolment-only one. For the few routes a user whose role
    requires a second factor must be able to reach before they have one: enrolling in it,
    and signing out."""
    if creds is None:
        raise HTTPException(401, "missing bearer token")
    return resolve_principal(creds.credentials, allow_scopes=("full", "mfa_enroll"))


def resolve_principal(token: str, *, allow_scopes: tuple[str, ...] = ("full",)) -> Principal:
    """Turn a bearer token into a live Principal, or raise HTTPException.

    Split out of the dependency so the WebSocket path (auth/ws.py) runs exactly
    the same checks as an HTTP request instead of a second, subtly different copy
    of them — the difference between the two is where the token arrives, nothing
    more.
    """
    try:
        claims = decode_token(token)
    except Exception:  # noqa: BLE001 — every decode failure is the same 401
        raise HTTPException(401, "invalid or expired token") from None

    amr = claims["amr"]           # presence is guaranteed by decode_token; the type is not
    if not (isinstance(amr, list) and amr and all(isinstance(a, str) for a in amr)):
        raise HTTPException(401, "invalid or expired token")
    amr = tuple(amr)

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
    # Same reason as the membership re-check above: a role removed from the
    # policy (or one that does not belong in this kind of org) must stop working
    # the moment the policy says so, not when some token expires. Principal.can
    # would deny every permission for an unknown role anyway, but a principal
    # that authenticates and then fails every call is a worse state than a clear
    # refusal.
    if not get_policy().role_valid_for(row.role, row.org_kind):
        raise HTTPException(403, "role is not valid for this organisation")
    # A revoked token: someone logged out everywhere, or an admin forced it
    # after a compromise, and this token was minted before that happened.
    # Checked against the live DB value, not anything cached in the token
    # itself — that is the entire point of a revocation mechanism.
    if claims.get("tv") != row.token_version:
        raise HTTPException(401, "token has been revoked")
    # Checked after the checks above so a revoked or deactivated user's limited token
    # is refused as such, not as merely "not finished signing in".
    scope = claims["scp"]
    if scope not in allow_scopes:
        raise HTTPException(403, "finish signing in first: a second factor is required")

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
        amr=amr, session_scope=scope,
        token_version=row.token_version, issued_at=int(claims["iat"]),
    ))


def requires(permission: str):
    """Route guard: `Depends(requires("quality:read"))`."""

    async def _guard(principal: Principal = Depends(current_principal)) -> Principal:
        principal.require(permission)
        return principal

    return _guard
