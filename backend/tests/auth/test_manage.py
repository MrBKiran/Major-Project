"""
Provisioning accounts.

Google sign-in only admits people an administrator already created, and until now the only
way to create one was to edit the database. This is the operator's tool for that: create a
user (with or without a password), give them a role, switch them off, set a password.

It goes through the same policy as everything else — a role must be valid for the kind of org
it is in, and a password must pass the same strength rules — and it never takes a password
on the command line, where it would land in shell history and process listings.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import text

from app.auth.audit import tail
from app.auth.principal import verify_password
from app.db.session import engine

from .helpers import bearer, login, make_user, stored_hash, token_for, unique_email

GOOD = "Correct-horse-battery-91"


def create(**kw):
    from app.auth.manage import create_user

    defaults = dict(email=unique_email("new"), full_name="New Person", org_id="ORG-RAMAN",
                    role="fleet_manager")
    return create_user(**{**defaults, **kw})


def user_row(email: str):
    with engine.connect() as c:
        return c.execute(text("SELECT id, email, full_name, password_hash, is_active, "
                              "token_version FROM users WHERE email = :e"),
                         {"e": email.lower()}).first()


def memberships_of(user_id: str) -> set[tuple[str, str]]:
    with engine.connect() as c:
        return {tuple(r) for r in c.execute(
            text("SELECT org_id, role FROM memberships WHERE user_id = :u"), {"u": user_id})}


# ── creating a user ────────────────────────────────────────────────────────

def test_a_user_with_no_password_can_only_come_in_by_google_or_phone(client, google):
    email = unique_email("g")
    uid = create(email=email)

    row = user_row(email)
    assert row.id == uid and row.is_active and row.full_name == "New Person"
    assert not row.password_hash.startswith("pbkdf2_")             # nothing to type
    assert memberships_of(uid) == {("ORG-RAMAN", "fleet_manager")}
    assert login(client, email, "anything").status_code == 401
    cred = google.add("c", sub="g-new-" + uid[-6:], email=email)
    assert client.post("/api/auth/google", json={"credential": cred}).status_code == 200


def test_a_user_created_with_a_password_can_sign_in_with_it(client):
    email = unique_email("p")
    create(email=email, password=GOOD)
    assert verify_password(GOOD, user_row(email).password_hash)
    assert login(client, email, GOOD).status_code == 200


def test_the_password_must_pass_the_strength_rules(client):
    from app.auth.manage import ManageError

    with pytest.raises(ManageError, match="password"):
        create(password="password123")


def test_the_address_is_stored_lower_case(client):
    email = unique_email("Mixed").replace("mixed", "MiXeD")
    create(email=email)
    assert user_row(email.lower()) is not None


@pytest.mark.parametrize("bad", ["", "not-an-email", "a@", "@b.com", "x" * 300 + "@example.com"])
def test_a_malformed_address_is_refused(bad):
    from app.auth.manage import ManageError

    with pytest.raises(ManageError, match="email"):
        create(email=bad)


def test_a_duplicate_address_is_refused():
    from app.auth.manage import ManageError

    email = unique_email("dup")
    create(email=email)
    with pytest.raises(ManageError, match="already exists"):
        create(email=email)


@pytest.mark.parametrize("org,role,why", [
    ("ORG-NOWHERE", "fleet_manager", "organisation"),          # no such org
    ("ORG-RAMAN", "platform_admin", "role"),                   # right role, wrong kind of org
    ("ORG-RAMAN", "oem_analyst", "role"),                      # retired
    ("ORG-CUSTOMERS", "made_up_role", "role"),
])
def test_a_role_that_does_not_belong_in_that_org_is_refused(org, role, why):
    from app.auth.manage import ManageError

    email = unique_email("bad")
    with pytest.raises(ManageError, match=why):
        create(email=email, org_id=org, role=role)
    assert user_row(email) is None, "a refused creation must leave nothing behind"


def test_creation_is_audited_without_any_password():
    email = unique_email("aud")
    create(email=email, password=GOOD)
    lines = [e for e in tail(limit=30, subject=email) if e["action"] == "auth.user_created"]
    assert lines
    assert GOOD not in json.dumps([str(e) for e in lines])


# ── more memberships ───────────────────────────────────────────────────────

def test_a_second_membership_can_be_added():
    from app.auth.manage import add_membership

    email = unique_email("two")
    uid = create(email=email)
    add_membership(email, "ORG-CUSTOMERS", "vehicle_owner")
    assert memberships_of(uid) == {("ORG-RAMAN", "fleet_manager"), ("ORG-CUSTOMERS", "vehicle_owner")}


def test_adding_the_same_membership_twice_is_harmless():
    from app.auth.manage import add_membership

    email = unique_email("twice")
    uid = create(email=email)
    add_membership(email, "ORG-RAMAN", "fleet_manager")
    assert memberships_of(uid) == {("ORG-RAMAN", "fleet_manager")}


def test_a_membership_is_held_to_the_same_rules():
    from app.auth.manage import ManageError, add_membership

    email = unique_email("rules")
    create(email=email)
    with pytest.raises(ManageError):
        add_membership(email, "ORG-RAMAN", "platform_admin")
    with pytest.raises(ManageError, match="no such user"):
        add_membership(unique_email("ghost"), "ORG-RAMAN", "fleet_manager")


# ── switching a user off and on ────────────────────────────────────────────

def test_deactivating_blocks_sign_in_and_ends_every_session(client):
    from app.auth.manage import set_active

    u = make_user()
    session = token_for(client, u["email"], u["password"])
    set_active(u["email"], False)

    assert client.get("/api/auth/me", headers=bearer(session)).status_code in (401, 403)
    assert login(client, u["email"], u["password"]).status_code == 403


def test_reactivating_restores_sign_in(client):
    from app.auth.manage import set_active

    u = make_user()
    set_active(u["email"], False)
    set_active(u["email"], True)
    assert login(client, u["email"], u["password"]).status_code == 200


def test_switching_an_unknown_user_off_is_an_error():
    from app.auth.manage import ManageError, set_active

    with pytest.raises(ManageError, match="no such user"):
        set_active(unique_email("ghost"), False)


# ── passwords ──────────────────────────────────────────────────────────────

def test_setting_a_password_works_enforces_the_rules_and_ends_sessions(client):
    from app.auth.manage import ManageError, set_password

    u = make_user()
    session = token_for(client, u["email"], u["password"])
    with pytest.raises(ManageError, match="password"):
        set_password(u["email"], "short")
    assert verify_password(u["password"], stored_hash(u["id"]))          # untouched

    set_password(u["email"], GOOD)
    assert login(client, u["email"], GOOD).status_code == 200
    assert client.get("/api/auth/me", headers=bearer(session)).status_code == 401


# ── the command line ───────────────────────────────────────────────────────

def test_the_cli_creates_a_user_and_reports_only_the_id(capsys):
    from app.auth.manage import main

    email = unique_email("cli")
    code = main(["create-user", "--email", email, "--name", "Cli Person",
                 "--org", "ORG-RAMAN", "--role", "fleet_manager"])
    out = capsys.readouterr().out
    assert code == 0 and user_row(email).id in out


def test_the_cli_reads_a_password_from_a_prompt_never_from_argv(capsys, monkeypatch):
    from app.auth import manage

    monkeypatch.setattr(manage.getpass, "getpass", lambda prompt="": GOOD)
    email = unique_email("cli")
    assert manage.main(["create-user", "--email", email, "--name", "P", "--org", "ORG-RAMAN",
                        "--role", "fleet_manager", "--password-prompt"]) == 0
    assert verify_password(GOOD, user_row(email).password_hash)
    assert GOOD not in capsys.readouterr().out

    with pytest.raises(SystemExit):                       # no --password flag exists
        manage.main(["create-user", "--email", unique_email("x"), "--name", "P", "--org",
                     "ORG-RAMAN", "--role", "fleet_manager", "--password", GOOD])


def test_the_cli_turns_a_refusal_into_a_message_and_a_nonzero_exit(capsys):
    from app.auth.manage import main

    code = main(["create-user", "--email", unique_email("cli"), "--name", "P",
                 "--org", "ORG-RAMAN", "--role", "platform_admin"])
    assert code == 2
    assert "role" in capsys.readouterr().err


def test_the_cli_can_deactivate_and_activate(capsys):
    from app.auth.manage import main

    u = make_user()
    assert main(["deactivate", "--email", u["email"]]) == 0
    assert user_row(u["email"]).is_active is False
    assert main(["activate", "--email", u["email"]]) == 0
    assert user_row(u["email"]).is_active is True


# ── a lost second factor, when no administrator can help ───────────────────────────────
# If the only administrator loses their authenticator and MFA is enforced, the API's reset
# needs an administrator who is already signed in. The operator's tool has to be able to.

def test_the_operator_can_reset_a_users_second_factor(client, clock):
    from app.auth.manage import reset_mfa
    from .mfa_helpers import enrolled_user, sign_in_with_totp

    u = enrolled_user(client, clock)
    session = sign_in_with_totp(client, u, clock).json()["access_token"]
    reset_mfa(u["email"])

    with engine.connect() as c:
        assert c.execute(text("SELECT count(*) FROM user_mfa WHERE user_id = :u"),
                         {"u": u["id"]}).scalar() == 0
    assert client.get("/api/auth/me", headers=bearer(session)).status_code == 401
    assert login(client, u["email"], u["password"]).status_code == 200      # plain sign-in again
    assert any(e["action"] == "auth.mfa_reset" for e in tail(limit=30, subject=u["id"]))


def test_resetting_an_unknown_users_second_factor_is_an_error():
    from app.auth.manage import ManageError, reset_mfa

    with pytest.raises(ManageError, match="no such user"):
        reset_mfa(unique_email("ghost"))


def test_the_cli_can_reset_a_second_factor(capsys, client, clock):
    from app.auth.manage import main
    from .mfa_helpers import enrolled_user

    u = enrolled_user(client, clock)
    assert main(["reset-mfa", "--email", u["email"]]) == 0
    assert "reset" in capsys.readouterr().out
