"""
Provisioning accounts — the operator's tool.

Google sign-in only admits people an administrator already created, and phone sign-in
only admits owners on file. This is how an administrator creates the rest: a user (with
or without a password), the role they hold in an organisation, and — when someone leaves
or a device is lost — switching them off or setting a password.

It applies the same rules as the rest of the system: a role must be valid for the kind of
organisation it sits in, and a password must pass the strength policy. A password is
never accepted on the command line, where it would be kept in shell history and visible
in process listings; it is read from a prompt.

    python -m app.auth.manage create-user --email a@b.com --name "A B" \\
        --org ORG-RAMAN --role fleet_manager [--password-prompt]
    python -m app.auth.manage add-membership --email a@b.com --org ORG-CUSTOMERS --role vehicle_owner
    python -m app.auth.manage deactivate --email a@b.com
    python -m app.auth.manage activate --email a@b.com
    python -m app.auth.manage set-password --email a@b.com
    python -m app.auth.manage reset-mfa --email a@b.com     # lost authenticator
"""

from __future__ import annotations

import argparse
import getpass
import secrets
import sys

from email_validator import EmailNotValidError, validate_email
from sqlalchemy import text

from app.auth import refresh
from app.auth.audit import AccessEvent, record
from app.auth.password_policy import check_new_password
from app.auth.policy import get_policy
from app.auth.principal import hash_password
from app.db.session import engine

# Stored in `password_hash` for an account that has no password. Not a valid hash, so
# password sign-in can never succeed against it (and burns the same work as a wrong one).
NO_PASSWORD = "!"


class ManageError(Exception):
    """A request that cannot be carried out; the message says why."""


def _normalise_email(email: str) -> str:
    try:
        # No deliverability check: this is provisioning, not a mail server, and it must
        # work offline.
        return validate_email(email, check_deliverability=False).normalized.lower()
    except EmailNotValidError as exc:
        raise ManageError(f"{email!r} is not a valid email address ({exc})") from None


def _check_membership(conn, org_id: str, role: str) -> None:
    kind = conn.execute(text("SELECT kind FROM organizations WHERE id = :o"), {"o": org_id}).scalar()
    if kind is None:
        raise ManageError(f"no such organisation: {org_id!r}")
    if not get_policy().role_valid_for(role, kind):
        raise ManageError(f"role {role!r} is not valid in an organisation of kind {kind!r}")


def _check_password(password: str, email: str) -> None:
    problems = check_new_password(password, email=email)
    if problems:
        raise ManageError("that password is not acceptable: it " + "; it ".join(problems))


def _find_user(conn, email: str):
    user = conn.execute(text("SELECT id, email FROM users WHERE email = :e"),
                        {"e": _normalise_email(email)}).first()
    if user is None:
        raise ManageError(f"no such user: {email}")
    return user


def _audit(action: str, subject: str, **detail) -> None:
    record(AccessEvent(action=action, principal_id=None, org_id=None, role=None,
                       subject=subject, outcome="allowed", detail={"by": "manage", **detail}))


def create_user(*, email: str, full_name: str, org_id: str, role: str,
                password: str | None = None) -> str:
    """Create a user with one membership. Returns the new user id.

    Without a password the account can only be entered by Google or a phone code.
    Everything is validated first and written in one transaction, so a refusal leaves
    nothing behind.
    """
    email = _normalise_email(email)
    if password is not None:
        _check_password(password, email)

    with engine.begin() as conn:
        _check_membership(conn, org_id, role)
        if conn.execute(text("SELECT 1 FROM users WHERE email = :e"), {"e": email}).first():
            raise ManageError(f"a user with the address {email} already exists")
        user_id = f"USR-{secrets.token_hex(6)}"
        conn.execute(
            text("INSERT INTO users (id, email, password_hash, full_name, is_active, "
                 "token_version, created_at) VALUES (:id, :email, :hash, :name, true, 0, now())"),
            {"id": user_id, "email": email, "name": full_name.strip(),
             "hash": hash_password(password) if password is not None else NO_PASSWORD})
        conn.execute(text("INSERT INTO memberships (user_id, org_id, role) VALUES (:u, :o, :r)"),
                     {"u": user_id, "o": org_id, "r": role})
    _audit("auth.user_created", email, org=org_id, role=role, has_password=password is not None)
    return user_id


def add_membership(email: str, org_id: str, role: str) -> None:
    with engine.begin() as conn:
        user = _find_user(conn, email)
        _check_membership(conn, org_id, role)
        conn.execute(text("INSERT INTO memberships (user_id, org_id, role) VALUES (:u, :o, :r) "
                          "ON CONFLICT DO NOTHING"), {"u": user.id, "o": org_id, "r": role})
    _audit("auth.user_updated", user.email, change="membership_added", org=org_id, role=role)


def set_active(email: str, active: bool) -> None:
    """Switch a user off or on. Switching off also ends every session they hold."""
    with engine.begin() as conn:
        user = _find_user(conn, email)
        conn.execute(
            text("UPDATE users SET is_active = :a, token_version = token_version + 1 "
                 "WHERE id = :u"), {"a": active, "u": user.id})
        refresh.revoke_all_for_user(conn, user.id)
    _audit("auth.user_updated", user.email, change="activated" if active else "deactivated")


def reset_mfa(email: str) -> None:
    """Remove a user's second factor and end their sessions — for a lost authenticator.

    The API has an administrator-only equivalent, but that needs an administrator who can
    still sign in; if the only one has lost their device (with MFA enforced) this is the way
    back in, from a shell on the server.
    """
    from app.auth import mfa

    with engine.begin() as conn:
        user = _find_user(conn, email)
        mfa.remove(conn, user.id)
        conn.execute(text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
                     {"u": user.id})
        refresh.revoke_all_for_user(conn, user.id)
    _audit("auth.mfa_reset", user.id, reset_by="manage")


def set_password(email: str, password: str) -> None:
    """Set a user's password and end their sessions."""
    email = _normalise_email(email)
    _check_password(password, email)
    with engine.begin() as conn:
        user = _find_user(conn, email)
        conn.execute(
            text("UPDATE users SET password_hash = :h, token_version = token_version + 1 "
                 "WHERE id = :u"), {"h": hash_password(password), "u": user.id})
        refresh.revoke_all_for_user(conn, user.id)
    _audit("auth.user_updated", user.email, change="password_set")


# ── command line ───────────────────────────────────────────────────────────

def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.auth.manage", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    create = sub.add_parser("create-user", help="create a user with one membership")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--org", required=True)
    create.add_argument("--role", required=True)
    create.add_argument("--password-prompt", action="store_true",
                        help="ask for a password; without it the account is Google/phone-only")

    member = sub.add_parser("add-membership", help="give an existing user another role")
    member.add_argument("--email", required=True)
    member.add_argument("--org", required=True)
    member.add_argument("--role", required=True)

    for name, help_ in (("deactivate", "switch a user off and end their sessions"),
                        ("activate", "switch a user back on")):
        sub.add_parser(name, help=help_).add_argument("--email", required=True)

    sub.add_parser("set-password", help="set a user's password (asks for it)").add_argument(
        "--email", required=True)
    sub.add_parser("reset-mfa", help="remove a user's second factor (lost device)").add_argument(
        "--email", required=True)
    return parser


def _prompt_password() -> str:
    first = getpass.getpass("New password: ")
    if getpass.getpass("Again: ") != first:
        raise ManageError("the two entries did not match")
    return first


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)
    try:
        if args.command == "create-user":
            password = _prompt_password() if args.password_prompt else None
            print(f"created {create_user(email=args.email, full_name=args.name, org_id=args.org, role=args.role, password=password)}")
        elif args.command == "add-membership":
            add_membership(args.email, args.org, args.role)
            print("membership added")
        elif args.command in ("deactivate", "activate"):
            set_active(args.email, args.command == "activate")
            print(f"{args.command}d")
        elif args.command == "reset-mfa":
            reset_mfa(args.email)
            print("two-step verification reset; sessions ended")
        elif args.command == "set-password":
            set_password(args.email, _prompt_password())
            print("password set; sessions ended")
    except ManageError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
