"""
Phase 1 — the role set shrinks from 10 to 8.

Two roles have no surface in the product and are retired:
  * oem_analyst        — a read-only subset of the quality engineer, no page
  * service_technician — no technician-facing screen exists

These tests pin (a) the resulting role set and every survivor's grants so a
later edit cannot widen a role by accident, (b) the data migration that moves
real memberships, and (c) that the system FAILS CLOSED on a membership whose
role is no longer defined — a leftover row must never quietly keep working.
"""

from __future__ import annotations

import pytest
from sqlalchemy import text

from app.auth.policy import get_policy
from app.auth.principal import issue_token

from .helpers import bearer, login, make_user, token_for

KEPT = {
    "platform_admin", "security_analyst", "oem_quality_engineer", "oem_quality_manager",
    "service_advisor", "centre_manager", "fleet_manager", "vehicle_owner",
}
RETIRED = {"oem_analyst", "service_technician"}

# Today's grants, copied verbatim. If one of these changes it should be a
# deliberate edit to this table, in the same commit, reviewed as such.
GRANTS = {
    "platform_admin": {"*"},
    "security_analyst": {"ueba:read", "ueba:release", "redteam:run", "vehicle:read"},
    "oem_quality_engineer": {"vehicle:read", "prediction:read", "maintenance:read",
                             "quality:read", "capa:draft"},
    "oem_quality_manager": {"vehicle:read", "prediction:read", "maintenance:read",
                            "quality:read", "capa:draft", "capa:dispatch"},
    "service_advisor": {"vehicle:read", "prediction:read", "maintenance:read",
                        "maintenance:write", "customer_pii:read", "appointment:read",
                        "appointment:write", "agent:trigger"},
    "centre_manager": {"vehicle:read", "prediction:read", "telemetry:read",
                       "maintenance:read", "customer_pii:read", "appointment:read",
                       "appointment:write", "forecast:read", "agent:trigger"},
    "fleet_manager": {"vehicle:read", "prediction:read", "telemetry:read",
                      "maintenance:read", "appointment:read", "appointment:write"},
    "vehicle_owner": {"vehicle:read", "prediction:read", "telemetry:read",
                      "maintenance:read", "appointment:read", "appointment:write"},
}


# ── the policy ─────────────────────────────────────────────────────────────

def test_policy_defines_exactly_the_kept_roles():
    assert set(get_policy().roles) == KEPT


@pytest.mark.parametrize("role", sorted(RETIRED))
def test_retired_roles_are_unknown_to_the_policy(role):
    assert get_policy().role(role) is None


@pytest.mark.parametrize("role", sorted(KEPT))
def test_kept_role_grants_are_unchanged(role):
    assert set(get_policy().roles[role].grants) == GRANTS[role]


def test_rbac_matrix_lists_exactly_the_kept_roles(client):
    tok = token_for(client, "admin@autosaarthi.io")
    r = client.get("/api/auth/rbac-matrix", headers=bearer(tok))
    assert r.status_code == 200
    assert {row["role"] for row in r.json()["roles"]} == KEPT


# ── the seed ───────────────────────────────────────────────────────────────

def test_seed_contains_no_retired_roles(db_engine):
    with db_engine.connect() as c:
        rows = c.execute(text("SELECT DISTINCT role FROM memberships")).all()
    assert {r[0] for r in rows}.isdisjoint(RETIRED)


def test_technician_account_is_not_seeded(db_engine):
    with db_engine.connect() as c:
        assert c.execute(text(
            "SELECT 1 FROM users WHERE email = 'tech@westernauto.example'")).first() is None


def test_hero_tenant_keeps_a_login_as_a_quality_engineer(db_engine):
    # Hero's only account exists to prove cross-OEM isolation; retiring its role
    # must not orphan the tenant.
    with db_engine.connect() as c:
        row = c.execute(text(
            "SELECT m.org_id, m.role FROM memberships m JOIN users u ON u.id = m.user_id "
            "WHERE u.email = 'analyst@hero.example'")).first()
    assert tuple(row) == ("ORG-HERO", "oem_quality_engineer")


def test_every_seeded_membership_is_valid_for_its_org_kind(db_engine):
    policy = get_policy()
    with db_engine.connect() as c:
        rows = c.execute(text(
            "SELECT m.role, o.kind FROM memberships m JOIN organizations o "
            "ON o.id = m.org_id")).all()
    bad = [(role, kind) for role, kind in rows if not policy.role_valid_for(role, kind)]
    assert not bad, f"memberships whose role is not valid for the org kind: {bad}"


# ── the data migration ─────────────────────────────────────────────────────

def _memberships(db_engine, uid):
    with db_engine.connect() as c:
        return {tuple(r) for r in c.execute(
            text("SELECT org_id, role FROM memberships WHERE user_id = :u"), {"u": uid})}


def _user_state(db_engine, uid):
    with db_engine.connect() as c:
        return c.execute(text(
            "SELECT is_active, token_version FROM users WHERE id = :u"), {"u": uid}).first()


def test_retirement_rehomes_analyst_and_removes_technician(db_engine):
    from app.db.role_retirement import retire_roles

    analyst = make_user(memberships=[("ORG-HERO", "oem_analyst")])
    tech = make_user(memberships=[("ORG-WESTERN", "service_technician")])
    versions = {u["id"]: _user_state(db_engine, u["id"]).token_version for u in (analyst, tech)}

    with db_engine.begin() as conn:
        summary = retire_roles(conn)

    assert _memberships(db_engine, analyst["id"]) == {("ORG-HERO", "oem_quality_engineer")}
    assert _memberships(db_engine, tech["id"]) == set()
    assert _user_state(db_engine, analyst["id"]).is_active is True
    assert _user_state(db_engine, tech["id"]).is_active is False   # no membership left
    assert summary["rehomed"] >= 1 and summary["removed"] >= 1 and summary["deactivated"] >= 1
    # Every affected token dies: a leftover JWT must not outlive its role.
    for u in (analyst, tech):
        assert _user_state(db_engine, u["id"]).token_version == versions[u["id"]] + 1


def test_retirement_does_not_deactivate_a_user_who_keeps_another_membership(db_engine):
    from app.db.role_retirement import retire_roles

    u = make_user(memberships=[("ORG-WESTERN", "service_technician"),
                               ("ORG-WESTERN", "service_advisor")])
    with db_engine.begin() as conn:
        retire_roles(conn)
    assert _memberships(db_engine, u["id"]) == {("ORG-WESTERN", "service_advisor")}
    assert _user_state(db_engine, u["id"]).is_active is True


def test_retirement_survives_a_user_who_already_holds_the_target_role(db_engine):
    # Re-homing would violate the (user, org, role) primary key; the redundant
    # row must simply be dropped rather than crash the migration halfway.
    from app.db.role_retirement import retire_roles

    u = make_user(memberships=[("ORG-HERO", "oem_analyst"), ("ORG-HERO", "oem_quality_engineer")])
    with db_engine.begin() as conn:
        retire_roles(conn)
    assert _memberships(db_engine, u["id"]) == {("ORG-HERO", "oem_quality_engineer")}


def test_retirement_is_idempotent(db_engine):
    from app.db.role_retirement import retire_roles

    make_user(memberships=[("ORG-HERO", "oem_analyst")])
    with db_engine.begin() as conn:
        retire_roles(conn)
    with db_engine.begin() as conn:
        again = retire_roles(conn)
    assert again == {"rehomed": 0, "removed": 0, "deactivated": 0}


def test_retirement_is_recorded_and_reversible(db_engine):
    from app.db.role_retirement import restore_roles, retire_roles

    analyst = make_user(memberships=[("ORG-HERO", "oem_analyst")])
    tech = make_user(memberships=[("ORG-WESTERN", "service_technician")])
    with db_engine.begin() as conn:
        retire_roles(conn)

    with db_engine.connect() as c:
        recorded = {tuple(r) for r in c.execute(text(
            "SELECT user_id, role, replaced_by FROM retired_memberships "
            "WHERE user_id IN (:a, :t)"), {"a": analyst["id"], "t": tech["id"]})}
    assert recorded == {(analyst["id"], "oem_analyst", "oem_quality_engineer"),
                        (tech["id"], "service_technician", None)}

    with db_engine.begin() as conn:
        restore_roles(conn)
    assert _memberships(db_engine, analyst["id"]) == {("ORG-HERO", "oem_analyst")}
    assert _memberships(db_engine, tech["id"]) == {("ORG-WESTERN", "service_technician")}
    assert _user_state(db_engine, tech["id"]).is_active is True


# ── fail closed ────────────────────────────────────────────────────────────

def test_login_refuses_a_user_whose_only_role_is_undefined(client):
    u = make_user(memberships=[("ORG-HERO", "oem_analyst")])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 403
    assert "access_token" not in r.json()


def test_login_ignores_an_undefined_membership_when_a_valid_one_exists(client):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-HERO", "oem_analyst")])
    r = login(client, u["email"], u["password"])
    assert r.status_code == 200, r.text
    assert r.json()["principal"]["role"] == "vehicle_owner"


def test_a_role_must_be_valid_for_the_kind_of_org_it_sits_in(client):
    # A platform_admin membership inside the customer org must not work: role
    # names are only meaningful within the org kinds the policy allows.
    u = make_user(memberships=[("ORG-CUSTOMERS", "platform_admin")])
    assert login(client, u["email"], u["password"]).status_code == 403


def test_an_already_issued_token_for_a_retired_role_is_refused(client, db_engine):
    u = make_user(memberships=[("ORG-HERO", "oem_analyst")])
    tok, _ = issue_token(u["id"], "ORG-HERO", "oem_analyst", 0, amr=["password"])
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 403
