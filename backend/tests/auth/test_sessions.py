"""
Phase 3 — every way of signing in ends in one place.

Password, Google and phone-code sign-in prove *who you are* differently, but what
happens next has to be identical or each method grows its own subtly different
idea of a session: choose a membership, refuse one the policy does not allow for
that method, mint the token, write the audit line.

The first group pins that shared behaviour through the password endpoint — the
only method that exists so far — so moving it into a single funnel is provably
behaviour-preserving. The second group is what the funnel adds.
"""

from __future__ import annotations

import dataclasses
import json

import pytest

from app.auth.audit import tail
from app.auth.policy import get_policy

from .helpers import login, make_user


# ── behaviour the funnel must preserve ─────────────────────────────────────

def test_a_single_membership_is_selected_automatically(client):
    u = make_user(memberships=[("ORG-RAMAN", "fleet_manager")])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 200
    assert r.json()["principal"]["org"]["id"] == "ORG-RAMAN"
    assert r.json()["principal"]["role"] == "fleet_manager"


def test_several_memberships_require_a_choice_and_list_only_usable_ones(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager"),
                               ("ORG-HERO", "oem_analyst")])       # a retired role
    r = login(client, u["email"], u["password"])
    assert r.status_code == 400
    offered = {(m["org_id"], m["role"]) for m in r.json()["detail"]["memberships"]}
    assert offered == {("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")}


def test_an_explicit_choice_selects_that_membership(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    r = login(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    assert r.status_code == 200
    assert r.json()["principal"]["org"]["id"] == "ORG-RAMAN"


def test_a_choice_the_user_does_not_hold_is_refused(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner")])
    r = login(client, u["email"], u["password"], org_id="ORG-PLATFORM", role="platform_admin")
    assert r.status_code == 403


def test_a_user_with_no_membership_is_refused(client):
    u = make_user(memberships=[])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 403


def test_the_token_names_the_membership_it_was_issued_for(client):
    from .helpers import claims_of

    u = make_user(memberships=[("ORG-RAMAN", "fleet_manager")])
    claims = claims_of(login(client, u["email"], u["password"]).json()["access_token"])
    assert (claims["sub"], claims["org"], claims["role"]) == (u["id"], "ORG-RAMAN", "fleet_manager")


# ── what the funnel adds ───────────────────────────────────────────────────

@pytest.fixture
def owners_may_only_use_sms(monkeypatch):
    """vehicle_owner stops allowing password sign-in, for this test only."""
    policy = get_policy()
    spec = policy.roles["vehicle_owner"]
    monkeypatch.setitem(policy.roles, "vehicle_owner",
                        dataclasses.replace(spec, login_methods=frozenset({"phone_otp"})))


def test_a_method_the_role_does_not_allow_is_refused(client, owners_may_only_use_sms):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner")])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 403
    assert "access_token" not in r.json()


def test_a_method_check_never_reveals_anything_before_the_password_is_right(
        client, owners_may_only_use_sms):
    # The refusal above must come AFTER the credential check, or "this account's
    # role cannot use passwords" becomes readable without knowing the password.
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner")])
    r = login(client, u["email"], "wrong-password")
    assert r.status_code == 401


def test_memberships_that_do_not_allow_the_method_are_not_offered(client, owners_may_only_use_sms):
    # Two memberships, one of which cannot use passwords: the user is not asked to
    # choose between them — only the usable one exists as far as this method goes.
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 200, r.text
    assert r.json()["principal"]["role"] == "fleet_manager"


def test_the_token_records_how_the_session_was_authenticated(client):
    from .helpers import claims_of

    u = make_user()
    claims = claims_of(login(client, u["email"], u["password"]).json()["access_token"])
    assert claims["amr"] == ["password"]        # RFC 8176 "authentication methods references"


def test_a_switch_keeps_the_method_the_session_was_authenticated_with(client):
    from .helpers import bearer, claims_of, token_for

    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok = token_for(client, u["email"], u["password"], org_id="ORG-RAMAN", role="fleet_manager")
    r = client.post("/api/auth/switch", json={"org_id": "ORG-CUSTOMERS", "role": "vehicle_owner"},
                    headers=bearer(tok))
    assert r.status_code == 200, r.text
    assert claims_of(r.json()["access_token"])["amr"] == ["password"]


def test_a_phone_session_cannot_switch_into_a_role_that_forbids_sms(client):
    # /switch re-issues a token WITHOUT asking for a credential. If it ignored how
    # the session was authenticated, anyone who could pass the weakest method any
    # of the user's roles allows could step into the strongest role they hold —
    # SIM-swap an owner's number and walk into their fleet-manager account.
    from app.auth.principal import issue_token
    from .helpers import bearer

    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok, _ = issue_token(u["id"], "ORG-CUSTOMERS", "vehicle_owner", 0, amr=["phone_otp"])
    r = client.post("/api/auth/switch", json={"org_id": "ORG-RAMAN", "role": "fleet_manager"},
                    headers=bearer(tok))
    assert r.status_code == 403


def test_a_phone_session_can_still_switch_between_roles_that_allow_sms(client):
    from app.auth.principal import issue_token
    from .helpers import bearer

    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner")])
    tok, _ = issue_token(u["id"], "ORG-CUSTOMERS", "vehicle_owner", 0, amr=["phone_otp"])
    r = client.post("/api/auth/switch", json={"org_id": "ORG-CUSTOMERS", "role": "vehicle_owner"},
                    headers=bearer(tok))
    assert r.status_code == 200, r.text


def test_the_memberships_list_marks_only_what_this_session_may_switch_to(client):
    # The org switcher is built from this list; offering a role the switch would
    # then refuse is a dead button at best.
    from app.auth.principal import issue_token
    from .helpers import bearer

    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    tok, _ = issue_token(u["id"], "ORG-CUSTOMERS", "vehicle_owner", 0, amr=["phone_otp"])
    rows = client.get("/api/auth/memberships", headers=bearer(tok)).json()["memberships"]
    assert {(m["org_id"], m["role"]) for m in rows} == {("ORG-CUSTOMERS", "vehicle_owner")}


def test_the_login_audit_line_records_the_method(client):
    u = make_user()
    assert login(client, u["email"], u["password"]).status_code == 200
    events = [e for e in tail(limit=20, subject=u["email"]) if e["action"] == "auth.login"]
    assert events, "no auth.login audit line was written"
    detail = events[0]["detail"]
    detail = json.loads(detail) if isinstance(detail, str) else detail
    assert detail.get("method") == "password"
