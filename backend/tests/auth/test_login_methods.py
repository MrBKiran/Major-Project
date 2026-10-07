"""
Phase 3 — which ways of signing in each role may use, and which need a second factor.

Both live in access_policy.yaml next to the role's grants, so "what may a vehicle
owner do, and how may they prove who they are" is answered in one place. The tables
below are copied out on purpose: widening a role's sign-in methods (above all
letting a privileged role in over SMS, which SIM-swapping defeats) should be a
deliberate edit to this file, in the same change, reviewed as such.
"""

from __future__ import annotations

import pytest

from app.auth.policy import AccessPolicy, get_policy

from .helpers import bearer, token_for

METHODS = {
    "platform_admin": {"password", "google"},
    "security_analyst": {"password", "google"},
    "oem_quality_engineer": {"password", "google"},
    "oem_quality_manager": {"password", "google"},
    "service_advisor": {"password", "google"},
    "centre_manager": {"password", "google"},
    "fleet_manager": {"password", "google"},
    "vehicle_owner": {"password", "google", "phone_otp"},
}

# True where the role can read customer PII, dispatch a CAPA, run the security
# console or administer users; False where the blast radius is one's own data.
MFA_REQUIRED = {
    "platform_admin": True,
    "security_analyst": True,
    "oem_quality_manager": True,
    "centre_manager": True,
    "service_advisor": True,
    "oem_quality_engineer": False,
    "fleet_manager": False,
    "vehicle_owner": False,
}


def _doc(**role_fields) -> dict:
    """A minimal policy document with one role, for constructing policies in tests."""
    return {
        "permissions": ["vehicle:read"],
        "org_kinds": {"customer": {"scope": "owned"}},
        "roles": {"vehicle_owner": {"org_kinds": ["customer"], "grants": ["vehicle:read"],
                                    **role_fields}},
    }


@pytest.mark.parametrize("role", sorted(METHODS))
def test_each_roles_login_methods_are_as_designed(role):
    assert set(get_policy().roles[role].login_methods) == METHODS[role]


@pytest.mark.parametrize("role", sorted(MFA_REQUIRED))
def test_each_roles_mfa_requirement_is_as_designed(role):
    assert get_policy().roles[role].mfa_required is MFA_REQUIRED[role]


def test_the_two_tables_cover_exactly_the_defined_roles():
    assert set(METHODS) == set(MFA_REQUIRED) == set(get_policy().roles)


def test_only_the_vehicle_owner_may_sign_in_by_sms():
    # An SMS code is only as strong as the phone number's owner: SIM-swap and SS7
    # attacks defeat it. Anyone whose account can read other people's data or send
    # a recall to a plant must not be reachable through it.
    by_sms = {name for name, spec in get_policy().roles.items()
              if "phone_otp" in spec.login_methods}
    assert by_sms == {"vehicle_owner"}


def test_an_unknown_login_method_in_the_policy_is_rejected_at_load():
    # A typo like "phone-otp" would otherwise silently mean "this role cannot sign
    # in that way" — or, worse, be matched by nothing and go unnoticed.
    with pytest.raises(ValueError, match="phone-otp"):
        AccessPolicy(doc=_doc(login_methods=["password", "phone-otp"]))


def test_a_role_that_declares_no_login_methods_gets_password_only():
    spec = AccessPolicy(doc=_doc()).roles["vehicle_owner"]
    assert set(spec.login_methods) == {"password"}


def test_a_role_that_declares_no_mfa_setting_requires_mfa():
    # Secure by default: a new role has to opt OUT of the second factor explicitly.
    assert AccessPolicy(doc=_doc()).roles["vehicle_owner"].mfa_required is True


def test_role_allows_method_helper_agrees_with_the_tables():
    policy = get_policy()
    assert policy.role_allows_method("vehicle_owner", "phone_otp") is True
    assert policy.role_allows_method("platform_admin", "phone_otp") is False
    assert policy.role_allows_method("no_such_role", "password") is False


def test_the_rbac_matrix_shows_methods_and_mfa(client):
    tok = token_for(client, "admin@autosaarthi.io")
    rows = client.get("/api/auth/rbac-matrix", headers=bearer(tok)).json()["roles"]
    by_role = {r["role"]: r for r in rows}
    assert set(by_role["vehicle_owner"]["login_methods"]) == METHODS["vehicle_owner"]
    assert by_role["platform_admin"]["mfa_required"] is True
