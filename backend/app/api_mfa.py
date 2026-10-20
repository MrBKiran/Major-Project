"""
Second-factor routes: enrol, sign in with a code, disable, recovery codes — and the
administrator's reset for a lost device.

Enrolment routes accept an ENROLMENT-ONLY session as well as a full one (see
deps.enrolling_principal): a user whose role requires a second factor they have not
set up could otherwise never set it up. Everything else here needs a full session.

`/mfa/verify` is the second step of signing in. It takes the challenge from step one
(not a bearer token — it is signed for a different audience) and a code.
"""

from __future__ import annotations

import re
import time
from types import SimpleNamespace

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.auth import mfa, refresh
from app.auth.audit import AccessEvent, record
from app.auth.deps import current_principal, enrolling_principal, requires
from app.auth.policy import get_policy
from app.auth.principal import (
    MAX_PASSWORD_LENGTH,
    Principal,
    decode_mfa_challenge,
    has_usable_password,
    verify_password,
)
from app.auth.ratelimit import (
    check_mfa,
    check_password_change,
    clear_mfa,
    record_mfa_failure,
    record_password_change_failure,
)
from app.auth.sessions import (
    SessionTransport,
    TokenResponse,
    mint_session,
    session_transport,
    usable_memberships,
)
from app.config import settings
from app.db.session import engine

router = APIRouter(prefix="/api/auth", tags=["mfa"])

_TOTP_CODE = re.compile(r"^[0-9]{6}$")

# For an account with no password to confirm, how recent the sign-in must be to change how
# the account is protected.
REAUTH_WINDOW_S = 600


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _audit(action: str, principal: Principal | None = None, *, subject: str | None = None,
           outcome: str = "allowed", user_id: str | None = None, **detail) -> None:
    record(AccessEvent(
        action=action, principal_id=(principal.user_id if principal else user_id),
        org_id=principal.org_id if principal else None,
        role=principal.role if principal else None,
        subject=subject or (principal.email if principal else None),
        outcome=outcome, detail=detail or None))


def _throttled(user_id: str, ip: str) -> HTTPException | None:
    allowed, retry_after = check_mfa(user_id, ip)
    if allowed:
        return None
    return HTTPException(429, f"too many attempts, retry in {retry_after}s",
                         headers={"Retry-After": str(retry_after)})


def _requires_mfa(role: str) -> bool:
    return settings.mfa_enforcement and get_policy().roles[role].mfa_required


# ── status / enrolment ─────────────────────────────────────────────────────

class CodeRequest(BaseModel):
    # ASCII digits only: \d would also accept other scripts' digits.
    code: str = Field(pattern=r"^[0-9]{6}$")


@router.get("/mfa")
async def mfa_status(principal: Principal = Depends(current_principal)) -> dict:
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT password_hash FROM users WHERE id = :u"),
                              {"u": principal.user_id}).scalar()
        return {
            "enrolled": mfa.is_enrolled(conn, principal.user_id),
            "required": _requires_mfa(principal.role),
            "recovery_codes_remaining": mfa.recovery_remaining(conn, principal.user_id),
            # Lets the screen know whether to ask for a password before enrolling.
            "has_password": has_usable_password(stored),
        }


class EnrollRequest(BaseModel):
    current_password: str | None = Field(default=None, max_length=MAX_PASSWORD_LENGTH)


def _reauthenticate(principal: Principal, current_password: str | None) -> None:
    """Prove the person at the keyboard is the account's owner, not merely whoever holds a token.

    Enrolling changes how the account is protected. Found in review: with only a session, an
    attacker with a stolen token could enrol THEIR authenticator — locking the owner out at
    the next sign-in and keeping access even through a password reset. So: the current
    password, throttled like any password guess; or, for an account that has none (Google or
    phone sign-in), a sign-in from the last few minutes.
    """
    with engine.connect() as conn:
        stored = conn.execute(text("SELECT password_hash FROM users WHERE id = :u"),
                              {"u": principal.user_id}).scalar()

    if has_usable_password(stored):
        allowed, retry_after = check_password_change(principal.user_id)
        if not allowed:
            raise HTTPException(429, f"too many attempts, retry in {retry_after}s",
                                headers={"Retry-After": str(retry_after)})
        if current_password is None or not verify_password(current_password, stored):
            if current_password is not None:            # an omitted field is a prompt, not a guess
                record_password_change_failure(principal.user_id)
            _audit("auth.mfa_failed", principal, outcome="denied",
                   reason="reauthentication_failed", stage="enrol")
            # 403, not 401 — see mfa_confirm: the session is valid.
            raise HTTPException(403, "confirm your password to set up two-step verification")
    elif time.time() - principal.issued_at > REAUTH_WINDOW_S:
        raise HTTPException(403, "sign in again to set up two-step verification")


@router.post("/mfa/enroll")
async def mfa_enroll(req: EnrollRequest | None = None,
                     principal: Principal = Depends(enrolling_principal)) -> dict:
    # An enrolment-only session has just been through a password sign-in and can do nothing
    # else, so it is not asked again; a FULL session is.
    if principal.session_scope == "full":
        _reauthenticate(principal, req.current_password if req else None)
    with engine.begin() as conn:
        started = mfa.begin_enrollment(conn, principal.user_id, principal.email)
    if started is None:
        raise HTTPException(409, "a second factor is already set up; disable it first to enrol again")
    secret, uri = started
    return {"secret": secret, "otpauth_uri": uri}


@router.post("/mfa/confirm")
async def mfa_confirm(req: CodeRequest, request: Request, transport: SessionTransport = Depends(session_transport),
                      principal: Principal = Depends(enrolling_principal)) -> dict:
    ip = _ip(request)
    if (refusal := _throttled(principal.user_id, ip)) is not None:
        raise refusal

    with engine.begin() as conn:
        outcome, recovery_codes = mfa.confirm_enrollment(conn, principal.user_id, req.code)
    if outcome == "no_pending":
        raise HTTPException(409, "start enrolment first")
    if outcome == "wrong_code":
        record_mfa_failure(principal.user_id, ip)
        _audit("auth.mfa_failed", principal, outcome="denied", reason="wrong_code", stage="enrol")
        # 403 rather than 401 (here and in _check_current_code): the session is valid,
        # and a 401 would sign the user out in the client.
        raise HTTPException(403, "that code is not right")

    clear_mfa(principal.user_id)
    _audit("auth.mfa_enrolled", principal)

    session = None
    if principal.session_scope != "full":
        # They came in on an enrolment-only session and have just proved they hold the
        # factor — which is exactly what the full session was being withheld for.
        # token_version from the principal, not a fresh read — see api_auth.switch_membership.
        user = SimpleNamespace(id=principal.user_id, email=principal.email,
                               full_name=principal.full_name,
                               token_version=principal.token_version)
        session = mint_session(
            user,
            SimpleNamespace(org_id=principal.org_id, role=principal.role,
                            name=principal.org_name, kind=principal.org_kind),
            amr=[*principal.amr, "totp"], transport=transport,
            audit_detail={"reason": "mfa_enrolled"},
        ).model_dump()
    return {"recovery_codes": recovery_codes, "session": session}


# ── signing in: step two ───────────────────────────────────────────────────

class MfaVerifyRequest(BaseModel):
    mfa_token: str = Field(min_length=1, max_length=4096)
    # A six-digit authenticator code or a recovery code (xxxxx-xxxxx).
    code: str = Field(min_length=6, max_length=24)


@router.post("/mfa/verify", response_model=TokenResponse)
async def mfa_verify(req: MfaVerifyRequest, request: Request,
                     transport: SessionTransport = Depends(session_transport)) -> TokenResponse:
    try:
        challenge = decode_mfa_challenge(req.mfa_token)
    except Exception:  # noqa: BLE001 — every failure to decode is the same 401
        raise HTTPException(401, "invalid or expired challenge") from None

    ip = _ip(request)
    user_id = challenge["sub"]
    if (refusal := _throttled(user_id, ip)) is not None:
        _audit("auth.mfa_failed", outcome="denied", user_id=user_id, subject=user_id,
               reason="rate_limited")
        raise refusal

    with engine.connect() as conn:
        user = conn.execute(
            text("SELECT id, email, full_name, is_active, token_version FROM users WHERE id = :u"),
            {"u": user_id}).first()
        membership = conn.execute(
            text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
                 "JOIN organizations o ON o.id = m.org_id "
                 "WHERE m.user_id = :u AND m.org_id = :o AND m.role = :r"),
            {"u": user_id, "o": challenge["org"], "r": challenge["role"]}).first()

    if user is None or membership is None or challenge["tv"] != user.token_version:
        raise HTTPException(401, "invalid or expired challenge")
    if not user.is_active:
        raise HTTPException(403, "user is deactivated")
    first_step = next((a for a in challenge["amr"] if a in ("password", "google", "phone_otp")), None)
    if first_step is None or not usable_memberships([membership], first_step):
        raise HTTPException(403, "this sign-in method is not available for your role")

    code = req.code.strip()
    with engine.begin() as conn:
        if _TOTP_CODE.match(code):
            passed, factor = mfa.check_totp(conn, user.id, code), "totp"
        else:
            passed, factor = mfa.use_recovery_code(conn, user.id, code), "recovery"

    if not passed:
        record_mfa_failure(user.id, ip)
        _audit("auth.mfa_failed", outcome="denied", user_id=user.id, subject=user.email,
               reason="wrong_code" if factor == "totp" else "wrong_recovery_code")
        raise HTTPException(401, "that code is not right")

    clear_mfa(user.id)
    _audit("auth.mfa_verified", outcome="allowed", user_id=user.id, subject=user.email,
           factor=factor)
    return mint_session(user, membership, amr=[*challenge["amr"], factor], transport=transport)


# ── managing it ────────────────────────────────────────────────────────────

def _check_current_code(principal: Principal, code: str, ip: str) -> None:
    """Require a valid authenticator code — a stolen session alone must not be able to
    weaken or replace the second factor."""
    if (refusal := _throttled(principal.user_id, ip)) is not None:
        raise refusal
    with engine.begin() as conn:
        ok = mfa.check_totp(conn, principal.user_id, code)
    if not ok:
        record_mfa_failure(principal.user_id, ip)
        _audit("auth.mfa_failed", principal, outcome="denied", reason="wrong_code", stage="manage")
        raise HTTPException(403, "that code is not right")
    clear_mfa(principal.user_id)


@router.post("/mfa/disable")
async def mfa_disable(req: CodeRequest, request: Request,
                      principal: Principal = Depends(current_principal)) -> dict:
    if _requires_mfa(principal.role):
        raise HTTPException(403, "your role requires a second factor; it cannot be switched off")
    _check_current_code(principal, req.code, _ip(request))
    with engine.begin() as conn:
        mfa.remove(conn, principal.user_id)
    _audit("auth.mfa_disabled", principal)
    return {"disabled": True}


@router.post("/mfa/recovery-codes")
async def mfa_regenerate_recovery_codes(req: CodeRequest, request: Request,
                                        principal: Principal = Depends(current_principal)) -> dict:
    _check_current_code(principal, req.code, _ip(request))
    with engine.begin() as conn:
        codes = mfa.issue_recovery_codes(conn, principal.user_id)
    _audit("auth.mfa_recovery_regenerated", principal)
    return {"recovery_codes": codes}


@router.post("/users/{user_id}/reset-mfa", dependencies=[Depends(requires("admin:manage_users"))])
async def reset_users_mfa(user_id: str,
                          principal: Principal = Depends(current_principal)) -> dict:
    """Administrator action for a lost or replaced device: remove the user's second
    factor and end their sessions, so they sign in plainly and enrol again.

    Sessions are ended because whoever reported the loss may be right that someone else
    has the device — and a session established with it should not outlive its removal.
    """
    with engine.begin() as conn:
        if conn.execute(text("SELECT 1 FROM users WHERE id = :u"), {"u": user_id}).first() is None:
            raise HTTPException(404, "unknown user")
        mfa.remove(conn, user_id)
        conn.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
                     {"u": user_id})
        refresh.revoke_all_for_user(conn, user_id)
    _audit("auth.mfa_reset", principal, subject=user_id, reset_by=principal.user_id)
    return {"reset": True, "user_id": user_id}
