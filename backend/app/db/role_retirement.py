"""
Move memberships off roles that have been retired from access_policy.yaml.

`memberships.role` is a free-form string with no foreign key to the policy, so
deleting a role from the YAML leaves its rows behind — and a row whose role the
policy no longer defines is not harmless dead data, it is an account in an
undefined state. The login and request paths fail closed on such rows, but that
only makes the accounts unusable; this makes them correct.

Shared by the Alembic migration and the tests so both exercise the same code.
Each retired role is either re-homed to its closest surviving role or removed.
Removal is deliberate where the nearest survivor would GRANT MORE (a technician
re-roled to service_advisor would gain customer PII) — quietly escalating
someone's access during a clean-up is the wrong way to fail.
"""

from __future__ import annotations

from sqlalchemy import text

# role -> (replacement or None, reason recorded in retired_memberships)
RETIRED_ROLES: dict[str, tuple[str | None, str]] = {
    "oem_analyst": (
        "oem_quality_engineer",
        "read-only subset of oem_quality_engineer with no screen of its own",
    ),
    "service_technician": (
        None,
        "no technician-facing surface; removed rather than re-roled because the "
        "nearest role (service_advisor) grants customer PII",
    ),
}


def retire_roles(conn) -> dict[str, int]:
    """Migrate every membership held under a retired role. Idempotent.

    Returns counts: rehomed (role changed in place), removed (row deleted) and
    deactivated (users left with no membership at all, who are switched off
    rather than left able to authenticate into nothing).
    """
    rehomed = removed = deactivated = 0
    touched: set[str] = set()

    for old, (new, reason) in RETIRED_ROLES.items():
        rows = conn.execute(
            text("SELECT user_id, org_id FROM memberships WHERE role = :r"), {"r": old}
        ).all()
        for user_id, org_id in rows:
            already_holds_new = new is not None and conn.execute(
                text("SELECT 1 FROM memberships WHERE user_id = :u AND org_id = :o AND role = :n"),
                {"u": user_id, "o": org_id, "n": new},
            ).first() is not None

            if new is not None and not already_holds_new:
                # In place: the (user, org, role) key makes delete+insert pointless.
                conn.execute(
                    text("UPDATE memberships SET role = :n "
                         "WHERE user_id = :u AND org_id = :o AND role = :old"),
                    {"n": new, "u": user_id, "o": org_id, "old": old},
                )
                action = "rehomed"
                rehomed += 1
            else:
                conn.execute(
                    text("DELETE FROM memberships "
                         "WHERE user_id = :u AND org_id = :o AND role = :old"),
                    {"u": user_id, "o": org_id, "old": old},
                )
                action = "removed"
                removed += 1

            record_id = conn.execute(
                text("INSERT INTO retired_memberships "
                     "(user_id, org_id, role, replaced_by, action, deactivated_user, reason, retired_at) "
                     "VALUES (:u, :o, :old, :n, :a, false, :why, now()) RETURNING id"),
                {"u": user_id, "o": org_id, "old": old, "n": new, "a": action, "why": reason},
            ).scalar()
            touched.add(user_id)

            if conn.execute(
                text("SELECT 1 FROM memberships WHERE user_id = :u"), {"u": user_id}
            ).first() is None:
                switched_off = conn.execute(
                    text("UPDATE users SET is_active = false "
                         "WHERE id = :u AND is_active RETURNING id"),
                    {"u": user_id},
                ).first()
                if switched_off is not None:
                    deactivated += 1
                    conn.execute(
                        text("UPDATE retired_memberships SET deactivated_user = true WHERE id = :i"),
                        {"i": record_id},
                    )

    # Once per user, not once per row: what matters is that any token minted
    # under the old role stops working, not how many memberships were touched.
    for user_id in touched:
        conn.execute(
            text("UPDATE users SET token_version = token_version + 1 WHERE id = :u"),
            {"u": user_id},
        )

    return {"rehomed": rehomed, "removed": removed, "deactivated": deactivated}


def restore_roles(conn, user_ids: list[str] | None = None) -> int:
    """Undo retire_roles from the retired_memberships record. Returns rows restored.

    `user_ids` limits the restore to specific users so a test cannot resurrect
    another test's rows. The Alembic downgrade passes nothing and restores all.
    """
    query = ("SELECT id, user_id, org_id, role, replaced_by, action, deactivated_user "
             "FROM retired_memberships")
    params: dict = {}
    if user_ids is not None:
        query += " WHERE user_id = ANY(:ids)"
        params["ids"] = list(user_ids)
    rows = conn.execute(text(query + " ORDER BY id DESC"), params).all()

    for rid, user_id, org_id, old, new, action, was_deactivated in rows:
        if action == "rehomed":
            conn.execute(
                text("UPDATE memberships SET role = :old "
                     "WHERE user_id = :u AND org_id = :o AND role = :n"),
                {"old": old, "u": user_id, "o": org_id, "n": new},
            )
        else:
            conn.execute(
                text("INSERT INTO memberships (user_id, org_id, role) VALUES (:u, :o, :old) "
                     "ON CONFLICT DO NOTHING"),
                {"u": user_id, "o": org_id, "old": old},
            )
        if was_deactivated:
            conn.execute(text("UPDATE users SET is_active = true WHERE id = :u"), {"u": user_id})
        conn.execute(text("DELETE FROM retired_memberships WHERE id = :i"), {"i": rid})
    return len(rows)
