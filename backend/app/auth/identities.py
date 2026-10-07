"""
External identities: "this Google account / this phone number is that user".

A `users` row is the person; an identity is one way of proving to be them. Keeping
them apart is what lets one person sign in by password, by Google and by phone
without three accounts, and lets one of those be cut off without touching the rest.

The invariant everything else leans on: a (provider, subject) pair belongs to at
most ONE user (the unique constraint, and the checks here). If two accounts could
claim the same Google `sub` or the same number, signing in with it would be
ambiguous — and an attacker who managed to attach a victim's identifier to their
own account would receive the victim's sign-ins.
"""

from __future__ import annotations

from sqlalchemy import text

# The `subject` is the provider's stable identifier: the Google `sub` claim (never
# the email, which can change hands) or the E.164 phone number.
PROVIDERS = frozenset({"google", "phone"})


class IdentityConflict(Exception):
    """The identity is already linked to a different user."""


def _check_provider(provider: str) -> None:
    if provider not in PROVIDERS:
        raise ValueError(f"unknown identity provider {provider!r}; expected one of {sorted(PROVIDERS)}")


def find_user_id(conn, provider: str, subject: str) -> str | None:
    _check_provider(provider)
    return conn.execute(
        text("SELECT user_id FROM user_identities WHERE provider = :p AND subject = :s"),
        {"p": provider, "s": subject},
    ).scalar()


def link_identity(conn, user_id: str, provider: str, subject: str) -> None:
    """Attach an identity to a user. Idempotent for the same user; raises
    IdentityConflict if it already belongs to someone else."""
    _check_provider(provider)
    inserted = conn.execute(
        text("INSERT INTO user_identities (user_id, provider, subject, created_at) "
             "VALUES (:u, :p, :s, now()) "
             "ON CONFLICT (provider, subject) DO NOTHING RETURNING id"),
        {"u": user_id, "p": provider, "s": subject},
    ).first()
    if inserted is None and find_user_id(conn, provider, subject) != user_id:
        raise IdentityConflict(f"{provider} identity is already linked to another user")


def mark_used(conn, provider: str, subject: str) -> None:
    """Stamp last_used_at — so a stale identity is visible to whoever reviews access."""
    _check_provider(provider)
    conn.execute(
        text("UPDATE user_identities SET last_used_at = now() "
             "WHERE provider = :p AND subject = :s"),
        {"p": provider, "s": subject},
    )
