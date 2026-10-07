"""
Ending sessions, and reading the access log.

These routes pre-date this work and are also covered by the live-server suite
(test_auth_revocation.py); the in-process copies exist so the whole session lifecycle
is exercised by the same harness as the new sign-in methods — and because the
enrolment-only session added in Phase 6 has to be able to sign out.
"""

from __future__ import annotations

import json


from app.auth.audit import tail
from app.config import settings

from .helpers import bearer, login, make_user, token_for
from .mfa_helpers import PRIVILEGED


# ── logout ─────────────────────────────────────────────────────────────────

def test_logout_ends_every_session_the_user_holds(client):
    u = make_user()
    a, b = token_for(client, u["email"], u["password"]), token_for(client, u["email"], u["password"])
    assert client.post("/api/auth/logout", headers=bearer(a)).json() == {
        "revoked": True, "scope": "all_sessions"}
    assert client.get("/api/auth/me", headers=bearer(a)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(b)).status_code == 401


def test_logout_needs_a_session(client):
    assert client.post("/api/auth/logout").status_code == 401


def test_a_half_signed_in_user_can_still_sign_out(client, monkeypatch):
    # An enrolment-only session must be able to abandon the sign-in.
    monkeypatch.setattr(settings, "mfa_enforcement", True)
    u = make_user(memberships=PRIVILEGED)
    tok = login(client, u["email"], u["password"]).json()["access_token"]
    assert client.post("/api/auth/logout", headers=bearer(tok)).status_code == 200
    assert client.post("/api/auth/mfa/enroll", headers=bearer(tok)).status_code == 401


def test_logout_is_audited(client):
    u = make_user()
    client.post("/api/auth/logout", headers=bearer(token_for(client, u["email"], u["password"])))
    assert any(e["action"] == "auth.revoke_sessions" for e in tail(limit=20, subject=u["id"]))


# ── an administrator ending someone else's sessions ────────────────────────

def test_an_admin_can_revoke_another_users_sessions(client):
    victim = make_user()
    session = token_for(client, victim["email"], victim["password"])
    admin = token_for(client, "admin@autosaarthi.io")
    r = client.post(f"/api/auth/users/{victim['id']}/revoke-sessions", headers=bearer(admin))
    assert r.status_code == 200 and r.json()["user_id"] == victim["id"]
    assert client.get("/api/auth/me", headers=bearer(session)).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(admin)).status_code == 200   # theirs untouched


def test_a_non_admin_cannot_revoke_anyone(client):
    victim, other = make_user(), make_user()
    tok = token_for(client, other["email"], other["password"])
    assert client.post(f"/api/auth/users/{victim['id']}/revoke-sessions",
                       headers=bearer(tok)).status_code == 403


def test_revoking_an_unknown_user_is_a_404(client):
    admin = token_for(client, "admin@autosaarthi.io")
    assert client.post("/api/auth/users/USR-nobody/revoke-sessions",
                       headers=bearer(admin)).status_code == 404


# ── the access log ─────────────────────────────────────────────────────────

def test_an_admin_reads_the_whole_access_log(client):
    u = make_user()
    login(client, u["email"], u["password"])
    admin = token_for(client, "admin@autosaarthi.io")
    body = client.get("/api/auth/access-log", params={"limit": 50}, headers=bearer(admin)).json()
    assert body["scoped_to_self"] is False
    assert any(e["subject"] == u["email"] for e in body["events"])


def test_an_ordinary_user_reads_only_their_own_history(client):
    a, b = make_user(), make_user()
    tok = token_for(client, a["email"], a["password"])
    token_for(client, b["email"], b["password"])
    body = client.get("/api/auth/access-log", params={"limit": 100}, headers=bearer(tok)).json()
    assert body["scoped_to_self"] is True
    assert body["events"] and {e["principal_id"] for e in body["events"]} == {a["id"]}


def test_the_log_cannot_be_used_to_probe_a_vin_the_caller_may_not_see(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    r = client.get("/api/auth/access-log", params={"subject": "MH12AB1001"}, headers=bearer(tok))
    assert r.status_code == 404


def test_the_access_log_never_holds_a_password(client):
    u = make_user(password="A-very-distinctive-passphrase-77")
    login(client, u["email"], u["password"])
    login(client, u["email"], "another-distinctive-wrong-guess")
    blob = json.dumps([str(e) for e in tail(limit=100, subject=u["email"])])
    assert "distinctive" not in blob
