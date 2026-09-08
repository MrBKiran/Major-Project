"""Authentication and identity routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, EmailStr
from sqlalchemy import text

from app.auth.deps import current_principal, requires
from app.auth.scope import can_access_vin
from app.auth.policy import get_policy
from app.auth.audit import AccessEvent, record
from app.auth.ratelimit import check_login, clear_login, record_login_failure
from app.auth.principal import Principal, issue_token, verify_password
from app.db.session import engine

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    password: str
    # Which membership to act under. Omitted picks the user's only membership;
    # required when they hold several, because scope differs per org and
    # guessing would silently grant the wrong one.
    org_id: str | None = None
    role: str | None = None


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    principal: dict


@router.post("/login", response_model=TokenResponse)
async def login(req: LoginRequest, request: Request) -> TokenResponse:
    ip = request.client.host if request.client else "unknown"
    allowed, retry_after = check_login(ip, req.email)
    if not allowed:
        record(AccessEvent(action="auth.login_failed", principal_id=None, org_id=None,
                            role=None, subject=req.email.lower(), outcome="denied",
                            detail={"reason": "rate_limited", "ip": ip}))
        raise HTTPException(429, f"too many attempts, retry in {retry_after}s",
                             headers={"Retry-After": str(retry_after)})

    with engine.connect() as conn:
        user = conn.execute(
            text("SELECT id, email, full_name, password_hash, is_active, token_version "
                 "FROM users WHERE email = :e"),
            {"e": req.email.lower()},
        ).first()

        # Same message and same work for "no such user" and "wrong password" —
        # a distinguishable response turns this into an account enumerator.
        if user is None or not verify_password(req.password, user.password_hash):
            record_login_failure(ip, req.email)
            record(AccessEvent(action="auth.login_failed", principal_id=None,
                                org_id=None, role=None, subject=req.email.lower(),
                                outcome="denied"))
            raise HTTPException(401, "invalid credentials")
        if not user.is_active:
            raise HTTPException(403, "user is deactivated")

        memberships = conn.execute(
            text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
                 "JOIN organizations o ON o.id = m.org_id WHERE m.user_id = :u"),
            {"u": user.id},
        ).all()

    if not memberships:
        raise HTTPException(403, "user belongs to no organisation")

    if req.org_id or req.role:
        chosen = next((m for m in memberships
                        if (not req.org_id or m.org_id == req.org_id)
                        and (not req.role or m.role == req.role)), None)
        if chosen is None:
            raise HTTPException(403, "no such membership for this user")
    elif len(memberships) == 1:
        chosen = memberships[0]
    else:
        raise HTTPException(400, {
            "error": "multiple memberships — specify org_id and role",
            "memberships": [
                {"org_id": m.org_id, "org_name": m.name, "role": m.role}
                for m in memberships
            ],
        })

    clear_login(ip, req.email)
    token, expires_in = issue_token(user.id, chosen.org_id, chosen.role, user.token_version)
    record(AccessEvent(action="auth.login", principal_id=user.id,
                        org_id=chosen.org_id, role=chosen.role,
                        subject=user.email, outcome="allowed"))
    principal = Principal(
        user_id=user.id, email=user.email, full_name=user.full_name,
        org_id=chosen.org_id, org_name=chosen.name, org_kind=chosen.kind,
        role=chosen.role,
    )
    return TokenResponse(access_token=token, expires_in=expires_in,
                          principal=principal.describe())


@router.post("/logout")
async def logout(principal: Principal = Depends(current_principal)) -> dict:
    """Revoke every token issued to this account, not just the one used here.

    There is no per-device session identity to revoke individually (see the
    note on `users.token_version`), so this is "log out everywhere" — the
    safer default, and the right behaviour for "I think my token leaked" or
    "I lost my laptop". A client that only wants to end its own session can
    simply discard the token instead of calling this.
    """
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
                      {"u": principal.user_id})
    record(AccessEvent(action="auth.revoke_sessions", principal_id=principal.user_id,
                        org_id=principal.org_id, role=principal.role,
                        subject=principal.user_id, outcome="allowed",
                        detail={"initiated_by": "self"}))
    return {"revoked": True, "scope": "all_sessions"}


@router.post("/users/{user_id}/revoke-sessions",
              dependencies=[Depends(requires("admin:manage_users"))])
async def revoke_user_sessions(user_id: str,
                                 principal: Principal = Depends(current_principal)) -> dict:
    """Admin action: force-revoke every token for another account.

    For a compromised or off-boarded user — bumping token_version invalidates
    every outstanding token immediately, independent of each token's own
    expiry. Deactivating the account (`users.is_active`) is the stronger,
    permanent action; this is for "kick them out and let them log back in"
    without disabling the account itself.
    """
    with engine.begin() as conn:
        updated = conn.execute(
            text("UPDATE users SET token_version = token_version + 1 "
                 "WHERE id = :u RETURNING id"), {"u": user_id},
        ).first()
    if updated is None:
        raise HTTPException(404, "unknown user")
    record(AccessEvent(action="auth.revoke_sessions", principal_id=principal.user_id,
                        org_id=principal.org_id, role=principal.role,
                        subject=user_id, outcome="allowed",
                        detail={"initiated_by": "admin", "admin_id": principal.user_id}))
    return {"revoked": True, "user_id": user_id, "scope": "all_sessions"}


@router.get("/me")
async def me(principal: Principal = Depends(current_principal)) -> dict:
    """Who am I, and what may I do. The frontend builds its navigation from
    this rather than hardcoding which pages exist per role."""
    return {
        **principal.describe(),
        "scope": {
            "brands": principal.brands,
            "center_ids": principal.center_ids,
            "fleet_vins": principal.fleet_vins,
        },
    }


@router.get("/memberships")
async def memberships(principal: Principal = Depends(current_principal)) -> dict:
    """Every membership this user holds, for an org switcher."""
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
                 "JOIN organizations o ON o.id = m.org_id WHERE m.user_id = :u "
                 "ORDER BY o.name"),
            {"u": principal.user_id},
        ).all()
    return {"memberships": [
        {"org_id": r.org_id, "org_name": r.name, "org_kind": r.kind, "role": r.role,
         "active": r.org_id == principal.org_id and r.role == principal.role}
        for r in rows
    ]}


@router.get("/access-log")
async def access_log(
    limit: int = 100,
    subject: str | None = None,
    principal: Principal = Depends(current_principal),
) -> dict:
    """Who accessed what.

    A principal without admin rights may only read their OWN history — an
    access log that lets any user see everyone else's activity is itself a
    disclosure. Subject filtering additionally requires the caller to be able
    to see that subject.
    """
    from app.auth.audit import tail

    if principal.can("admin:manage_users"):
        rows = tail(limit=min(limit, 500), subject=subject)
    else:
        if subject and not can_access_vin(principal, subject):
            raise HTTPException(404, "unknown subject")
        rows = tail(limit=min(limit, 200), subject=subject,
                     principal_id=principal.user_id)
    return {"events": rows, "scoped_to_self": not principal.can("admin:manage_users")}


class SwitchRequest(BaseModel):
    org_id: str
    role: str


@router.post("/switch", response_model=TokenResponse)
async def switch_membership(req: SwitchRequest,
                              principal: Principal = Depends(current_principal)) -> TokenResponse:
    """Change which of the caller's own memberships is active, without asking
    for the password again.

    Deliberately narrower than /login: it can only select a membership that
    ALREADY belongs to the authenticated caller — it verifies that against the
    DB rather than trusting the request body, so this can never be used to
    step into someone else's org. Re-authenticating with a password to move
    between two roles you already legitimately hold would just be friction for
    no security benefit; that guarantee is what makes skipping it safe here.
    """
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
                 "JOIN organizations o ON o.id = m.org_id "
                 "WHERE m.user_id = :u AND m.org_id = :o AND m.role = :r"),
            {"u": principal.user_id, "o": req.org_id, "r": req.role},
        ).first()
        user = conn.execute(
            text("SELECT token_version FROM users WHERE id = :u"), {"u": principal.user_id},
        ).first()

    if row is None:
        raise HTTPException(403, "not a membership held by this account")

    token, expires_in = issue_token(principal.user_id, row.org_id, row.role, user.token_version)
    record(AccessEvent(action="auth.login", principal_id=principal.user_id,
                        org_id=row.org_id, role=row.role, subject=principal.email,
                        outcome="allowed", detail={"switched_from": principal.org_id}))
    new_principal = Principal(
        user_id=principal.user_id, email=principal.email, full_name=principal.full_name,
        org_id=row.org_id, org_name=row.name, org_kind=row.kind, role=row.role,
    )
    return TokenResponse(access_token=token, expires_in=expires_in,
                          principal=new_principal.describe())


@router.get("/rbac-matrix", dependencies=[Depends(requires("admin:manage_users"))])
async def rbac_matrix() -> dict:
    """Role x permission grid — the human counterpart of /api/ueba/matrix."""
    policy = get_policy()
    return {"permissions": policy.permissions, "roles": policy.matrix()}
