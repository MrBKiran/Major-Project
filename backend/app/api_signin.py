"""
Sign-in methods other than email + password: Google now, phone codes next.

Each one authenticates in its own way and then hands the user to issue_session()
(app/auth/sessions.py), so the rest — which membership, which methods a role may
use, the token, the audit line — is the same for all of them.
"""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import text

from app.auth.audit import AccessEvent, record
from app.auth.google import (
    GoogleClaims,
    GoogleUnavailable,
    GoogleVerificationError,
    GoogleVerifier,
    get_google_verifier,
)
from app.auth import ratelimit
from app.auth.identities import IdentityConflict, find_user_id, link_identity, mark_used
from app.auth.methods import available_methods
from app.auth.otp import complete_sign_in, start_challenge, verify_code
from app.auth.phone import mask_phone, normalize_phone
from app.auth.ratelimit import check_google, record_google_failure
from app.auth.sessions import (
    MfaChallenge,
    SessionTransport,
    TokenResponse,
    issue_session,
    respond,
    session_transport,
)
from app.auth.sms import SmsSender, get_sms_sender, render_message
from app.config import settings
from app.db.session import engine

router = APIRouter(prefix="/api/auth", tags=["auth"])
log = logging.getLogger("autosaarthi.signin")

# A Google ID token is 1-2 KB. Anything near this is not one, and is refused before
# it is verified — or fetched keys for.
MAX_CREDENTIAL_CHARS = 8192


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _audit_failure(method: str, reason: str, subject: str | None = None, **detail) -> None:
    record(AccessEvent(action="auth.login_failed", principal_id=None, org_id=None, role=None,
                       subject=subject, outcome="denied",
                       detail={"method": method, "reason": reason, **detail}))


# ── Google ─────────────────────────────────────────────────────────────────

class GoogleLoginRequest(BaseModel):
    # The ID token from Google Identity Services.
    credential: str = Field(min_length=1, max_length=MAX_CREDENTIAL_CHARS)
    # Which membership to act under; see LoginRequest.
    org_id: str | None = None
    role: str | None = None


def _google_refusal(ip: str, reason: str, status: int, message: str,
                    subject: str | None = None) -> HTTPException:
    record_google_failure(ip)
    _audit_failure("google", reason, subject)
    return HTTPException(status, message)


def _resolve_google_user(claims: GoogleClaims):
    """The provisioned user this Google account is, linking it on first use.

    Returns (user, None) or (None, reason). The account is bound to Google's `sub`;
    the email is consulted only when no account is linked yet, and only to attach a
    Google account to a user an administrator already created.
    """
    with engine.begin() as conn:
        columns = "id, email, full_name, is_active, token_version"
        linked_user_id = find_user_id(conn, "google", claims.sub)
        if linked_user_id is not None:
            user = conn.execute(text(f"SELECT {columns} FROM users WHERE id = :u"),
                                {"u": linked_user_id}).first()
        else:
            # Normalised here too rather than trusting every verifier to have done it:
            # users.email is stored lower-case, and a case-sensitive miss would read
            # as "not registered".
            user = conn.execute(text(f"SELECT {columns} FROM users WHERE email = :e"),
                                {"e": claims.email.strip().lower()}).first()
            if user is None:
                return None, "not_registered"

        if not user.is_active:
            return None, "deactivated"

        if linked_user_id is None:
            # An address is used to link ONCE. If this user already has a Google
            # account on file, a different `sub` claiming the same address is not
            # the same person — addresses get recycled — so it gets nothing.
            already_has_google = conn.execute(
                text("SELECT 1 FROM user_identities WHERE user_id = :u AND provider = 'google'"),
                {"u": user.id}).first()
            if already_has_google:
                return None, "identity_conflict"
            try:
                link_identity(conn, user.id, "google", claims.sub)
            except IdentityConflict:                 # lost a race to link the same sub
                return None, "identity_conflict"
            record(AccessEvent(action="auth.identity_linked", principal_id=user.id, org_id=None,
                               role=None, subject=user.email, outcome="allowed",
                               detail={"provider": "google"}))
        mark_used(conn, "google", claims.sub)
    return user, None


@router.post("/google", response_model=TokenResponse | MfaChallenge)
async def google_login(req: GoogleLoginRequest, request: Request,
                       transport: SessionTransport = Depends(session_transport),
                       verifier: GoogleVerifier = Depends(get_google_verifier)
                       ) -> TokenResponse | MfaChallenge:
    if not settings.google_client_id:
        raise HTTPException(404, "google sign-in is not enabled")

    ip = _client_ip(request)
    allowed, retry_after = check_google(ip)
    if not allowed:
        _audit_failure("google", "rate_limited", ip=ip)
        raise HTTPException(429, f"too many attempts, retry in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})

    try:
        # Network I/O (Google's keys) — off the event loop.
        claims = await asyncio.to_thread(verifier.verify, req.credential)
    except GoogleUnavailable:
        _audit_failure("google", "google_unavailable")
        raise HTTPException(503, "could not reach Google to verify the sign-in; try again") from None
    except GoogleVerificationError:
        raise _google_refusal(ip, "invalid_credential", 401, "invalid credentials") from None

    if not claims.email_verified:
        raise _google_refusal(ip, "email_not_verified", 401,
                              "the Google account's email address is not verified",
                              subject=claims.email)

    user, reason = _resolve_google_user(claims)
    if user is None:
        # Unlike a password guess, reaching here means the caller proved they own
        # this Google account, so saying it is not registered reveals nothing they
        # could not already know — and tells them what to ask an administrator for.
        messages = {
            "not_registered": "this Google account is not registered with AutoSaarthi",
            "deactivated": "user is deactivated",
            "identity_conflict": "this account is already linked to a different Google account",
        }
        raise _google_refusal(ip, reason, 403, messages[reason], subject=claims.email)

    try:
        return respond(transport.response, issue_session(user, methods=("google",), org_id=req.org_id,
                                                         role=req.role, transport=transport))
    except HTTPException as exc:
        if exc.status_code == 403:
            raise _google_refusal(ip, "membership_refused", 403, exc.detail,
                                  subject=user.email) from None
        raise


# ── Phone code ─────────────────────────────────────────────────────────────

class OtpRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)


class OtpVerifyRequest(BaseModel):
    phone: str = Field(min_length=1, max_length=32)
    # ASCII digits only: \d would also accept other scripts' digits.
    code: str = Field(pattern=r"^[0-9]{6}$")
    org_id: str | None = None
    role: str | None = None


def _require_phone_sign_in() -> None:
    if "phone_otp" not in available_methods():
        raise HTTPException(404, "phone sign-in is not enabled")


def _normalised_phone_or_422(raw: str) -> str:
    phone = normalize_phone(raw)
    if phone is None:
        # Whether a string is a mobile number says nothing about whether anyone has
        # registered it, so this is safe to report — and useful to the person typing.
        raise HTTPException(422, "enter a mobile number that can receive an SMS")
    return phone


def _deliver_code(sender: SmsSender, phone: str, code: str) -> None:
    """Runs AFTER the response, so a slow or failing provider cannot change what the
    caller sees or how long it takes — either would tell them the number is real."""
    try:
        sender.send(phone, render_message(code))
    except Exception as exc:  # noqa: BLE001 — nothing to tell the caller; the log is the record
        log.error("could not deliver a sign-in code to %s: %s", mask_phone(phone),
                  type(exc).__name__)


@router.post("/otp/request", status_code=202)
async def otp_request(req: OtpRequest, request: Request, background: BackgroundTasks,
                      sender: SmsSender = Depends(get_sms_sender)) -> dict:
    _require_phone_sign_in()
    phone = _normalised_phone_or_422(req.phone)
    ip = _client_ip(request)

    allowed, retry_after = ratelimit.check_otp_request(ip, phone)
    if not allowed:
        _audit_failure("phone_otp", "rate_limited", subject=mask_phone(phone), ip=ip)
        raise HTTPException(429, f"too many requests, retry in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})

    with engine.begin() as conn:
        code = start_challenge(conn, phone, ip)
    record(AccessEvent(action="auth.otp_requested", principal_id=None, org_id=None, role=None,
                       subject=mask_phone(phone), outcome="allowed",
                       detail={"eligible": code is not None}))

    if code is not None:
        background.add_task(_deliver_code, sender, phone, code)
    # The same body whether or not the number is real.
    return {"status": "sent_if_registered", "expires_in": settings.otp_ttl_s,
            "resend_after": ratelimit.OTP_RESEND_COOLDOWN.window_s}


# Why a sign-in was refused -> what the caller is told. Only failures that happen
# AFTER a correct code (so the caller has proved they hold the phone) are specific;
# everything else is the same 401 as a wrong code, so a stranger learns nothing.
_OTP_REFUSALS = {
    "deactivated": (403, "user is deactivated"),
    "method_not_allowed": (403, "this sign-in method is not available for your role"),
}


@router.post("/otp/verify", response_model=TokenResponse | MfaChallenge)
async def otp_verify(req: OtpVerifyRequest, request: Request,
                     transport: SessionTransport = Depends(session_transport)) -> TokenResponse | MfaChallenge:
    _require_phone_sign_in()
    phone = _normalised_phone_or_422(req.phone)
    ip = _client_ip(request)

    allowed, retry_after = ratelimit.check_otp_verify(ip)
    if not allowed:
        _audit_failure("phone_otp", "rate_limited", subject=mask_phone(phone), ip=ip)
        raise HTTPException(429, f"too many attempts, retry in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})

    # One transaction: the attempt is counted, the code consumed and the account
    # resolved together. A failed guess must still COMMIT its attempt, which is why
    # nothing here raises inside the block.
    with engine.begin() as conn:
        ok, reason = verify_code(conn, phone, req.code)
        user = None
        if ok:
            user, reason = complete_sign_in(conn, phone)

    if reason is not None or user is None:
        _audit_failure("phone_otp", reason or "unknown", subject=mask_phone(phone))
        status, message = _OTP_REFUSALS.get(reason, (401, "invalid or expired code"))
        raise HTTPException(status, message)

    try:
        return respond(transport.response, issue_session(user, methods=("phone_otp",), org_id=req.org_id,
                                                         role=req.role, transport=transport))
    except HTTPException as exc:
        if exc.status_code == 403:
            _audit_failure("phone_otp", "membership_refused", subject=mask_phone(phone))
        raise
