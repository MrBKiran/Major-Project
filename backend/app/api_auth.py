"""Authentication and identity routes."""

from __future__ import annotations

from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import text

from app.auth.audit import AccessEvent, record
from app.auth.deps import current_principal, enrolling_principal, requires
from app.auth.methods import available_methods
from app.auth.password_policy import check_new_password
from app.auth.policy import get_policy
from app.auth.principal import (
    MAX_PASSWORD_LENGTH,
    Principal,
    burn_password_work,
    has_usable_password,
    hash_password,
    needs_rehash,
    verify_password,
)
from app.auth.ratelimit import (
    check_login,
    check_principal,
    check_password_change,
    clear_login,
    clear_password_change,
    record_login_failure,
    record_password_change_failure,
)
from app.auth.scope import can_access_vin
from app.auth.sessions import (
    MfaChallenge,
    TokenResponse,
    issue_session,
    mint_session,
    respond,
    usable_memberships,
)
from app.config import settings
from app.db.session import engine

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    email: EmailStr
    # Capped so one request cannot demand unbounded work; see MAX_PASSWORD_LENGTH.
    password: str = Field(max_length=MAX_PASSWORD_LENGTH)
    # Which membership to act under. Omitted picks the user's only membership;
    # required when they hold several, because scope differs per org and
    # guessing would silently grant the wrong one.
    org_id: str | None = None
    role: str | None = None


def _upgrade_password_hash(user_id: str, old_hash: str, password: str) -> None:
    """Replace a cheaper stored hash with one at today's cost.

    Conditional on the stored hash still being the one that was just verified. If
    a password change or reset landed in between, a blind UPDATE would write the
    OLD password's hash over it and quietly resurrect the password the user had
    just replaced.
    """
    with engine.begin() as write:
        write.execute(
            text("UPDATE users SET password_hash = :new "
                 "WHERE id = :u AND password_hash = :old"),
            {"new": hash_password(password), "u": user_id, "old": old_hash},
        )


@router.get("/config")
async def auth_config() -> dict:
    """What the sign-in screen needs, and nothing else. Public: there is nobody to
    authenticate yet. The Google client id is public by design — the browser needs
    it to render the button."""
    return {
        "methods": available_methods(),
        "google_client_id": settings.google_client_id or None,
        "mfa_enforced": settings.mfa_enforcement,
    }


@router.post("/login", response_model=TokenResponse | MfaChallenge)
async def login(req: LoginRequest, request: Request,
                response: Response) -> TokenResponse | MfaChallenge:
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

        # Same message and — this is the part that used to be untrue — the same
        # work for "no such user", "unusable stored hash" and "wrong password".
        # verify_password already burns a derivation for an unusable hash; an
        # absent user has no hash to hand it, so burn one explicitly. A response
        # that is fast exactly when the account does not exist is an enumerator.
        if user is None:
            burn_password_work(req.password)
            password_ok = False
        else:
            password_ok = verify_password(req.password, user.password_hash)
        if not password_ok:
            record_login_failure(ip, req.email)
            record(AccessEvent(action="auth.login_failed", principal_id=None,
                                org_id=None, role=None, subject=req.email.lower(),
                                outcome="denied"))
            raise HTTPException(401, "invalid credentials")
        if not user.is_active:
            raise HTTPException(403, "user is deactivated")

        # The password is right, so this is the one moment the plaintext is in
        # hand to move an older, cheaper hash to today's cost.
        if needs_rehash(user.password_hash):
            _upgrade_password_hash(user.id, user.password_hash, req.password)

    # Everything after "the password is right" is shared with every other way of
    # signing in — see auth/sessions.py.
    result = issue_session(user, methods=("password",), org_id=req.org_id, role=req.role)
    clear_login(ip, req.email)
    return respond(response, result)      # 202 + a challenge while a second factor is owed


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)
    new_password: str = Field(min_length=1, max_length=MAX_PASSWORD_LENGTH)


@router.post("/password/change", response_model=TokenResponse)
async def change_password(req: PasswordChangeRequest,
                          principal: Principal = Depends(current_principal)) -> TokenResponse:
    """Change your own password.

    Asks for the CURRENT one — a stolen session alone must not be enough to lock the
    owner out — throttles wrong guesses at it, ends every session (the usual reason
    to change a password is "someone else may have it"), and returns a fresh token so
    the caller is not signed out along with everyone else.
    """
    # Each attempt hashes twice (the current password, then the new one against it), and
    # policy failures are not "wrong guesses" so the throttle below never sees them: without
    # this budget an authenticated user could keep a worker busy indefinitely.
    within_budget, retry_after = check_principal(principal.user_id, heavy=True)
    if not within_budget:
        raise HTTPException(429, f"too many requests, retry in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})

    allowed, retry_after = check_password_change(principal.user_id)
    if not allowed:
        raise HTTPException(429, f"too many attempts, retry in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})

    with engine.connect() as conn:
        user = conn.execute(
            text("SELECT id, email, full_name, password_hash, token_version "
                 "FROM users WHERE id = :u"), {"u": principal.user_id}).first()

    if not has_usable_password(user.password_hash):
        raise HTTPException(403, "this account has no password to change")

    if not verify_password(req.current_password, user.password_hash):
        record_password_change_failure(principal.user_id)
        record(AccessEvent(action="auth.password_change_failed", principal_id=principal.user_id,
                           org_id=principal.org_id, role=principal.role, subject=user.email,
                           outcome="denied", detail={"reason": "wrong_current_password"}))
        # 403, not 401: the SESSION is fine and the client treats any 401 as "your
        # session is gone" and signs the user out — a typo here must not do that.
        raise HTTPException(403, "the current password is incorrect")

    problems = check_new_password(req.new_password, email=user.email,
                                  current_hash=user.password_hash)
    if problems:
        raise HTTPException(422, {"error": "that password is not acceptable",
                                  "reasons": problems})

    # Conditional on the hash still being the one just verified, like the rehash on
    # login: a concurrent change must not be silently overwritten.
    with engine.begin() as write:
        changed = write.execute(
            text("UPDATE users SET password_hash = :new, token_version = token_version + 1 "
                 "WHERE id = :u AND password_hash = :old RETURNING token_version"),
            {"new": hash_password(req.new_password), "u": user.id, "old": user.password_hash},
        ).first()
    if changed is None:
        raise HTTPException(409, "the password was changed elsewhere; sign in again")

    clear_password_change(principal.user_id)
    record(AccessEvent(action="auth.password_changed", principal_id=principal.user_id,
                       org_id=principal.org_id, role=principal.role, subject=user.email,
                       outcome="allowed", detail={"sessions_revoked": True}))
    return mint_session(
        SimpleNamespace(id=user.id, email=user.email, full_name=user.full_name,
                        token_version=changed.token_version),
        SimpleNamespace(org_id=principal.org_id, role=principal.role,
                        name=principal.org_name, kind=principal.org_kind),
        amr=principal.amr, audit_detail={"reason": "password_changed"})


@router.post("/logout")
async def logout(principal: Principal = Depends(enrolling_principal)) -> dict:
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
    # Only what THIS session could switch to: /switch enforces the same rule, and an
    # org switcher that offers a role the switch would then refuse is a dead button.
    return {"memberships": [
        {"org_id": r.org_id, "org_name": r.name, "org_kind": r.kind, "role": r.role,
         "active": r.org_id == principal.org_id and r.role == principal.role}
        for r in usable_memberships(rows, principal.login_method,
                                    second_factor_done=principal.second_factor_done)
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

    # Switching asks for no credential, so it must not become a way around the
    # rule that a role can only be reached by the methods it allows: a session
    # proven by an SMS code may move only between roles that accept an SMS code.
    if row is None or not usable_memberships([row], principal.login_method,
                                             second_factor_done=principal.second_factor_done):
        raise HTTPException(403, "not a membership held by this account")

    # The new token keeps the SAME `amr`: switching changes where you act, not how
    # you proved who you are.
    # token_version comes from the principal (what this request was authenticated with),
    # NOT a fresh read: if the user's sessions were revoked a moment ago, the new token must
    # be born revoked too.
    user = SimpleNamespace(id=principal.user_id, email=principal.email,
                           full_name=principal.full_name, token_version=principal.token_version)
    return mint_session(user, row, amr=principal.amr,
                        audit_detail={"switched_from": principal.org_id})


@router.get("/rbac-matrix", dependencies=[Depends(requires("admin:manage_users"))])
async def rbac_matrix() -> dict:
    """Role x permission grid — the human counterpart of /api/ueba/matrix."""
    policy = get_policy()
    return {"permissions": policy.permissions, "roles": policy.matrix()}
