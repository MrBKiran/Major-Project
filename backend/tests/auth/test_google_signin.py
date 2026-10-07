"""
Phase 4 — sign in with Google.

The browser obtains a Google ID token (Google Identity Services) and posts it here.
Google's signature, audience, issuer and expiry are checked by app/auth/google.py
(tested separately, against a real RS256 token); these tests use a fake verifier and
pin what the endpoint does with a token Google has vouched for.

The rules that matter:
  * only people an administrator already provisioned can sign in — Google proves who
    you are, it does not decide who may use AutoSaarthi;
  * the account is bound to Google's `sub`, never to the email, because addresses get
    recycled: a stable id survives an address changing hands, an email does not;
  * the email may be used ONCE, to link a provisioned user to their Google account —
    and only if that user has no Google account linked yet;
  * an unverified email is worth nothing.
"""

from __future__ import annotations

import json
import uuid

from sqlalchemy import text

from app.auth.audit import tail
from app.auth.policy import get_policy
from app.config import settings
from app.db.session import engine

from .helpers import bearer, claims_of, make_user, unique_email


def google_login(client, credential: str, **extra):
    return client.post("/api/auth/google", json={"credential": credential, **extra})


def _identities(user_id: str) -> list[tuple]:
    with engine.connect() as c:
        return [tuple(r) for r in c.execute(
            text("SELECT provider, subject FROM user_identities WHERE user_id = :u ORDER BY id"),
            {"u": user_id})]


def _sub() -> str:
    return "g-" + uuid.uuid4().hex[:16]


def _staff(email: str | None = None, **kw) -> dict:
    """A provisioned user with no usable password — the normal state of a Google-only account."""
    return make_user(email=email or unique_email("g"), password_hash="!",
                     memberships=[("ORG-RAMAN", "fleet_manager")], **kw)


# ── on / off ───────────────────────────────────────────────────────────────

def test_the_endpoint_does_not_exist_until_google_is_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    assert google_login(client, "anything").status_code == 404


# ── signing in ─────────────────────────────────────────────────────────────

def test_a_provisioned_user_signs_in_with_a_verified_google_account(client, google):
    u, sub = _staff(), _sub()
    cred = google.add("cred-1", sub=sub, email=u["email"])

    r = google_login(client, cred)

    assert r.status_code == 200, r.text
    assert r.json()["principal"]["email"] == u["email"]
    assert r.json()["principal"]["role"] == "fleet_manager"
    assert claims_of(r.json()["access_token"])["amr"] == ["google"]


def test_the_token_from_a_google_sign_in_works_on_the_api(client, google):
    u = _staff()
    tok = google_login(client, google.add("c", sub=_sub(), email=u["email"])).json()["access_token"]
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 200


def test_first_sign_in_links_the_google_account_and_the_audit_line_says_so(client, google):
    u, sub = _staff(), _sub()
    assert google_login(client, google.add("c", sub=sub, email=u["email"])).status_code == 200

    assert _identities(u["id"]) == [("google", sub)]
    actions = {e["action"]: e for e in tail(limit=20, subject=u["email"])}
    assert "auth.identity_linked" in actions
    detail = actions["auth.login"]["detail"]
    assert (json.loads(detail) if isinstance(detail, str) else detail)["method"] == "google"


def test_the_linked_sub_is_stamped_used(client, google):
    u, sub = _staff(), _sub()
    google_login(client, google.add("c", sub=sub, email=u["email"]))
    with engine.connect() as c:
        assert c.execute(text("SELECT last_used_at FROM user_identities WHERE subject = :s"),
                         {"s": sub}).scalar() is not None


def test_email_matching_ignores_case(client, google):
    u = _staff(email=f"m{uuid.uuid4().hex[:6]}.case@example.com")
    cred = google.add("c", sub=_sub(), email=u["email"].upper())
    assert google_login(client, cred).status_code == 200


def test_a_user_with_a_password_can_use_google_too(client, google):
    u = make_user()                                          # has a real password
    assert google_login(client, google.add("c", sub=_sub(), email=u["email"])).status_code == 200


# ── the account follows the sub, not the email ─────────────────────────────

def test_after_linking_sign_in_follows_the_sub_even_if_the_email_claim_changes(client, google):
    u, sub = _staff(), _sub()
    google_login(client, google.add("first", sub=sub, email=u["email"]))

    # Same Google account (same sub), but the address on it is now different.
    cred = google.add("second", sub=sub, email="renamed." + uuid.uuid4().hex[:6] + "@example.com")
    r = google_login(client, cred)
    assert r.status_code == 200
    assert r.json()["principal"]["email"] == u["email"]


def test_a_recycled_address_with_a_new_sub_cannot_take_over_a_linked_account(client, google):
    # The address a user signed up with later belongs to someone else's Google
    # account (a new sub). Matching on the email again would hand them the account.
    u = _staff()
    google_login(client, google.add("owner", sub=_sub(), email=u["email"]))

    intruder = google.add("intruder", sub=_sub(), email=u["email"])
    r = google_login(client, intruder)

    assert r.status_code == 403
    assert len(_identities(u["id"])) == 1


def test_one_google_account_cannot_be_linked_to_two_users(client, google):
    a, b = _staff(), _staff()
    sub = _sub()
    google_login(client, google.add("a", sub=sub, email=a["email"]))
    # b's address, but a's Google account: the sub decides, and it is a's.
    r = google_login(client, google.add("b", sub=sub, email=b["email"]))
    assert r.json()["principal"]["email"] == a["email"]
    assert _identities(b["id"]) == []


# ── who may not sign in ────────────────────────────────────────────────────

def test_an_unverified_email_is_refused_and_links_nothing(client, google):
    u = _staff()
    cred = google.add("c", sub=_sub(), email=u["email"], email_verified=False)
    assert google_login(client, cred).status_code == 401
    assert _identities(u["id"]) == []


def test_a_google_account_nobody_provisioned_is_refused_and_creates_nothing(client, google):
    email = unique_email("stranger")
    r = google_login(client, google.add("c", sub=_sub(), email=email))
    assert r.status_code == 403
    with engine.connect() as c:
        assert c.execute(text("SELECT 1 FROM users WHERE email = :e"), {"e": email}).first() is None


def test_a_credential_google_did_not_issue_is_refused(client, google):
    assert google_login(client, "forged-or-expired").status_code == 401


def test_a_deactivated_user_is_refused(client, google):
    u = _staff(active=False)
    assert google_login(client, google.add("c", sub=_sub(), email=u["email"])).status_code == 403


def test_an_outage_at_google_is_a_503_not_a_credential_error(client, google):
    google.unavailable = True
    assert google_login(client, "whatever").status_code == 503


def test_an_absurdly_long_credential_is_rejected_before_it_is_verified(client, google):
    r = google_login(client, "x" * 100_000)
    assert r.status_code == 422
    assert google.calls == []


# ── the same rules as every other way in ───────────────────────────────────

def test_a_role_that_does_not_allow_google_cannot_be_entered_this_way(client, google, monkeypatch):
    import dataclasses

    policy = get_policy()
    monkeypatch.setitem(policy.roles, "fleet_manager", dataclasses.replace(
        policy.roles["fleet_manager"], login_methods=frozenset({"password"})))
    u = _staff()
    assert google_login(client, google.add("c", sub=_sub(), email=u["email"])).status_code == 403


def test_several_memberships_need_a_choice_over_google_as_well(client, google):
    u = make_user(email=unique_email("g"), password_hash="!",
                  memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    cred = google.add("c", sub=_sub(), email=u["email"])

    assert google_login(client, cred).status_code == 400
    r = google_login(client, cred, org_id="ORG-RAMAN", role="fleet_manager")
    assert r.status_code == 200
    assert r.json()["principal"]["org"]["id"] == "ORG-RAMAN"


def test_google_sessions_are_switchable_between_roles_that_allow_google(client, google):
    u = make_user(email=unique_email("g"), password_hash="!",
                  memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = google_login(client, google.add("c", sub=_sub(), email=u["email"]),
                       org_id="ORG-RAMAN", role="fleet_manager").json()["access_token"]
    r = client.post("/api/auth/switch", json={"org_id": "ORG-CUSTOMERS", "role": "vehicle_owner"},
                    headers=bearer(tok))
    assert r.status_code == 200
    assert claims_of(r.json()["access_token"])["amr"] == ["google"]


# ── abuse ──────────────────────────────────────────────────────────────────

def test_repeated_failures_from_one_address_are_rate_limited(client, google):
    for _ in range(20):
        assert google_login(client, "bad").status_code == 401
    r = google_login(client, "bad")
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_a_few_failures_do_not_block_a_valid_sign_in(client, google):
    # The budget is per source address and only failures spend it, so a mistyped
    # or expired credential never locks a legitimate user out.
    u = _staff()
    for _ in range(3):
        google_login(client, "bad")
    assert google_login(client, google.add("c", sub=_sub(), email=u["email"])).status_code == 200


def test_failures_are_audited_with_the_method_and_a_reason(client, google):
    u = _staff()
    google_login(client, google.add("c", sub=_sub(), email=u["email"], email_verified=False))
    lines = [e for e in tail(limit=30, subject=u["email"]) if e["action"] == "auth.login_failed"]
    assert lines, "the refusal was not audited"
    detail = lines[0]["detail"]
    detail = json.loads(detail) if isinstance(detail, str) else detail
    assert detail["method"] == "google" and detail["reason"] == "email_not_verified"
