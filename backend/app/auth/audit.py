"""
Principal access log — who read or changed what, and under which role.

The counterpart to app/ueba/audit.py. That one records what the *agents* did;
this records what the *people* did. Both are needed to answer the question a
regulator or a customer actually asks after an incident: who saw my data.

Written to Postgres rather than a file because it is queried (by subject, by
principal, by time) rather than just tailed, and because it must survive the
same backup and retention policy as the data it describes.

Deliberately NOT hash-chained. The agent audit is tamper-evident because agents
are the untrusted actor being watched; this log is written by the application
about authenticated humans, and pretending a row an attacker with DB access
could rewrite is tamper-proof would be security theatre. Integrity here is a
database-permissions and backup problem, and is documented as such.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from dataclasses import dataclass

from sqlalchemy import text

from app.db.session import engine

logger = logging.getLogger("autosaarthi.access")

# Actions worth recording. Reads of aggregate, non-personal data (model
# metrics, the tool catalogue) are omitted on purpose — logging everything
# makes the log unreadable and hides the entries that matter.
AUDITED = {
    "vehicle.read_one", "vehicle.list", "customer_pii.read",
    "appointment.write", "maintenance.write",
    "quality.read", "capa.draft", "capa.dispatch",
    "agent.trigger", "console.demo", "ueba.read", "ueba.release", "redteam.run",
    "auth.login", "auth.login_failed", "auth.revoke_sessions",
    "auth.identity_linked", "auth.otp_requested",
    "auth.password_changed", "auth.password_change_failed",
    "auth.mfa_enrolled", "auth.mfa_verified", "auth.mfa_failed", "auth.mfa_disabled",
    "auth.mfa_reset", "auth.mfa_recovery_regenerated",
    "auth.user_created", "auth.user_updated",
}


@dataclass
class AccessEvent:
    action: str
    principal_id: str | None
    org_id: str | None
    role: str | None
    subject: str | None          # VIN, capa id, agent id — what was touched
    outcome: str                 # allowed | denied
    detail: dict | None = None


def record(event: AccessEvent) -> None:
    """Append one access event. Never raises into the request path.

    An audit write failing must not take down the endpoint it is auditing —
    but it must be loud, because silently losing the access log is worse than
    the request failing.
    """
    if event.action not in AUDITED:
        return
    try:
        with engine.begin() as conn:
            conn.execute(
                text("""
                    INSERT INTO access_audit
                        (ts, action, principal_id, org_id, role, subject, outcome, detail)
                    VALUES (:ts, :action, :pid, :org, :role, :subject, :outcome, :detail)
                """),
                {
                    "ts": dt.datetime.now(dt.timezone.utc),
                    "action": event.action, "pid": event.principal_id,
                    "org": event.org_id, "role": event.role,
                    "subject": event.subject, "outcome": event.outcome,
                    "detail": json.dumps(event.detail or {}),
                },
            )
    except Exception as exc:  # noqa: BLE001
        logger.error("ACCESS AUDIT WRITE FAILED action=%s subject=%s: %s",
                      event.action, event.subject, exc)


def record_principal(principal, action: str, subject: str | None = None,
                      outcome: str = "allowed", **detail) -> None:
    record(AccessEvent(
        action=action, principal_id=principal.user_id, org_id=principal.org_id,
        role=principal.role, subject=subject, outcome=outcome, detail=detail or None,
    ))


def tail(limit: int = 100, subject: str | None = None,
          principal_id: str | None = None) -> list[dict]:
    clauses, params = [], {"limit": limit}
    if subject:
        clauses.append("subject = :subject")
        params["subject"] = subject
    if principal_id:
        clauses.append("principal_id = :pid")
        params["pid"] = principal_id
    where = f"WHERE {' AND '.join(clauses)}" if clauses else ""

    with engine.connect() as conn:
        rows = conn.execute(text(
            f"SELECT ts, action, principal_id, org_id, role, subject, outcome, detail "
            f"FROM access_audit {where} ORDER BY ts DESC LIMIT :limit"
        ), params).all()
    return [dict(r._mapping) for r in rows]
