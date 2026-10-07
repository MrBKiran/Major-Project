"""
Where a verified identity becomes a session.

Password, Google and phone-code sign-in each prove who you are in their own way,
then all call issue_session(). What happens next is deliberately the same for
every method — otherwise each grows its own subtly different idea of a session:

  1. find the user's memberships;
  2. drop the ones the policy does not allow — a role that is undefined, that means
     nothing in that kind of org, or that may not be reached by THIS method;
  3. pick one (or ask the caller to);
  4. apply the second factor: an enrolled user gets a CHALLENGE instead of a session;
     one whose role requires a factor they lack gets an enrolment-only session;
  5. mint the token, recording how it was authenticated (`amr`);
  6. write the audit line.

Authenticating the credential is the caller's job and comes first. The method
restriction is applied here, after it, so "this role cannot sign in that way" is
never readable without already knowing the password.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text

from app.auth import mfa
from app.auth.audit import AccessEvent, record
from app.auth.policy import get_policy
from app.auth.principal import Principal, issue_mfa_challenge, issue_token
from app.config import settings
from app.db.session import engine


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    principal: dict
    # Set when the session is not yet complete: "mfa_enroll" means it can enrol in a
    # second factor and nothing else.
    next_step: str | None = None


class MfaChallenge(BaseModel):
    """Returned INSTEAD of a session when a second factor is still owed (HTTP 202)."""

    mfa_required: bool = True
    mfa_token: str
    expires_in: int


def respond(response: Response, result: "TokenResponse | MfaChallenge"):
    """Set the status a sign-in result calls for: 202 while a second factor is owed."""
    if isinstance(result, MfaChallenge):
        response.status_code = 202
    return result


def usable_memberships(rows, method: str, *, second_factor_done: bool = True) -> list:
    """The memberships a session authenticated by `method` may act in.

    `rows` need `.role` and `.kind` (the org kind). Used at sign-in, when switching, and
    when listing what can be switched to — one rule, three places.

    With MFA enforced, a role that requires a second factor is off limits to a session
    that has not passed one (`second_factor_done` false). At sign-in that is handled by
    the gate in issue_session (which offers enrolment), so the default is True there;
    /switch and /memberships pass the session's real state.
    """
    policy = get_policy()
    usable = []
    for m in rows:
        if not (policy.role_valid_for(m.role, m.kind) and policy.role_allows_method(m.role, method)):
            continue
        if (not second_factor_done and settings.mfa_enforcement
                and policy.roles[m.role].mfa_required):
            continue
        usable.append(m)
    return usable


def mint_session(user, membership, *, amr: Sequence[str], audit_detail: dict | None = None,
                 scope: str = "full", next_step: str | None = None) -> TokenResponse:
    """Token + audit line + response for a user acting in `membership`.

    `user` needs .id, .email, .full_name, .token_version; `membership` needs
    .org_id, .role, .name (org name), .kind.
    """
    token, expires_in = issue_token(user.id, membership.org_id, membership.role,
                                    user.token_version, amr=amr, scope=scope)
    detail = {"method": next((a for a in amr if a in ("password", "google", "phone_otp")), amr[0]),
              **({"scope": scope} if scope != "full" else {}), **(audit_detail or {})}
    record(AccessEvent(action="auth.login", principal_id=user.id,
                       org_id=membership.org_id, role=membership.role,
                       subject=user.email, outcome="allowed", detail=detail))
    principal = Principal(
        user_id=user.id, email=user.email, full_name=user.full_name,
        org_id=membership.org_id, org_name=membership.name, org_kind=membership.kind,
        role=membership.role, amr=tuple(amr), session_scope=scope,
    )
    return TokenResponse(access_token=token, expires_in=expires_in,
                         principal=principal.describe(), next_step=next_step)


def issue_session(user, *, methods: Sequence[str], org_id: str | None = None,
                  role: str | None = None) -> "TokenResponse | MfaChallenge":
    """Turn an authenticated user into a session, or raise HTTPException.

    `methods` is how they were authenticated, primary method first (see
    Principal.amr). `org_id`/`role` are the caller's explicit choice of membership;
    omitted, a single usable membership is taken and several are refused with the
    list to choose from, because scope differs per org and guessing would silently
    grant the wrong one.
    """
    primary = methods[0]
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT m.org_id, m.role, o.name, o.kind FROM memberships m "
                 "JOIN organizations o ON o.id = m.org_id WHERE m.user_id = :u"),
            {"u": user.id},
        ).all()

    if not rows:
        raise HTTPException(403, "user belongs to no organisation")

    # `memberships.role` is a free-form string, so nothing in the database stops a
    # row naming a role the policy no longer defines, or one that means nothing in
    # that kind of org (a platform_admin row inside a customer org). Such a row is
    # refused here — and again on every request in current_principal.
    policy = get_policy()
    if not any(policy.role_valid_for(m.role, m.kind) for m in rows):
        raise HTTPException(403, "no usable membership for this account")
    allowed = usable_memberships(rows, primary)
    if not allowed:
        raise HTTPException(403, "this sign-in method is not available for your role")

    if org_id or role:
        chosen = next((m for m in allowed
                       if (not org_id or m.org_id == org_id) and (not role or m.role == role)),
                      None)
        if chosen is None:
            raise HTTPException(403, "no such membership for this user")
    elif len(allowed) == 1:
        chosen = allowed[0]
    else:
        raise HTTPException(400, {
            "error": "multiple memberships — specify org_id and role",
            "memberships": [
                {"org_id": m.org_id, "org_name": m.name, "role": m.role} for m in allowed
            ],
        })

    return _apply_second_factor(user, chosen, methods)


def _apply_second_factor(user, membership, methods: Sequence[str]) -> "TokenResponse | MfaChallenge":
    """The last gate before a session exists.

    - Enrolled in a second factor (voluntarily or not): owe the code — return a challenge.
    - Not enrolled, but MFA is enforced and the role requires it: an enrolment-only
      session, so the user can set it up (they could not otherwise; refusing outright
      would lock every new privileged user out).
    - Otherwise: a full session.
    """
    if any(m in ("totp", "recovery") for m in methods):      # already passed one
        return mint_session(user, membership, amr=methods)

    with engine.connect() as conn:
        enrolled = mfa.is_enrolled(conn, user.id)
    if enrolled:
        token, expires_in = issue_mfa_challenge(user.id, membership.org_id, membership.role,
                                                user.token_version, amr=methods)
        return MfaChallenge(mfa_token=token, expires_in=expires_in)

    if settings.mfa_enforcement and get_policy().roles[membership.role].mfa_required:
        return mint_session(user, membership, amr=methods, scope="mfa_enroll",
                            next_step="mfa_enroll")
    return mint_session(user, membership, amr=methods)
