"""
JWT revocation tests.

A stateless JWT has one structural problem: once issued, there is no way to
invalidate it before it expires — a leaked token, or an admin needing to kick
someone out immediately, both have no answer. `users.token_version` closes
that gap (see the column's docstring in app/db/models.py and the check in
app/auth/deps.py): it is embedded in every token and re-checked against the
live DB value on every request, so bumping it invalidates every outstanding
token for that user immediately, independent of each token's own expiry.

Separate file, own httpx client — deliberately not sharing test_tenancy.py's
cached-token helpers, since these tests exist specifically to invalidate
tokens, and a shared cache would make that interact badly with unrelated
tests reusing the same cached (now-revoked) token.

Requires the API running on :8010 and the tenancy seed applied — same
prerequisites as test_tenancy.py.
"""

from __future__ import annotations

import os

import httpx

BASE = os.environ.get("AUTOSAARTHI_API", "http://127.0.0.1:8010")
PW = "autosaarthi"

ADVISOR = "advisor@westernauto.example"
SOUTHERN_ADVISOR = "advisor@southernmotors.example"
ADMIN = "admin@autosaarthi.io"

_client = httpx.Client(base_url=BASE, timeout=30)


def _login(email: str) -> str:
    r = _client.post("/api/auth/login", json={"email": email, "password": PW})
    r.raise_for_status()
    return r.json()["access_token"]


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_token_works_before_logout():
    tok = _login(ADVISOR)
    assert _client.get("/api/auth/me", headers=_auth(tok)).status_code == 200


def test_logout_revokes_the_token_that_called_it():
    tok = _login(ADVISOR)
    assert _client.get("/api/auth/me", headers=_auth(tok)).status_code == 200

    r = _client.post("/api/auth/logout", headers=_auth(tok))
    assert r.status_code == 200
    assert r.json() == {"revoked": True, "scope": "all_sessions"}

    r = _client.get("/api/auth/me", headers=_auth(tok))
    assert r.status_code == 401
    assert "revoked" in r.json()["detail"].lower()


def test_logout_revokes_every_outstanding_token_not_just_one():
    """The documented "log out everywhere" semantics: a second, independently
    issued token for the SAME account must also stop working."""
    tok_a = _login(ADVISOR)
    tok_b = _login(ADVISOR)
    assert tok_a != tok_b, "two logins should not coincidentally mint identical tokens"

    _client.post("/api/auth/logout", headers=_auth(tok_a))

    assert _client.get("/api/auth/me", headers=_auth(tok_a)).status_code == 401
    assert _client.get("/api/auth/me", headers=_auth(tok_b)).status_code == 401, \
        "logout must revoke ALL of this account's tokens, not just the one used to call it"


def test_fresh_login_after_logout_works_again():
    tok = _login(ADVISOR)
    _client.post("/api/auth/logout", headers=_auth(tok))

    fresh = _login(ADVISOR)
    assert _client.get("/api/auth/me", headers=_auth(fresh)).status_code == 200


def test_logout_does_not_affect_other_accounts():
    """A stray bug in the revocation check (e.g. comparing against the wrong
    user's token_version) would show up as this test failing, not the ones
    above — worth its own case."""
    advisor_tok = _login(ADVISOR)
    southern_tok = _login(SOUTHERN_ADVISOR)

    _client.post("/api/auth/logout", headers=_auth(advisor_tok))

    assert _client.get("/api/auth/me", headers=_auth(advisor_tok)).status_code == 401
    assert _client.get("/api/auth/me", headers=_auth(southern_tok)).status_code == 200


def test_admin_can_force_revoke_another_users_sessions():
    target_tok = _login(SOUTHERN_ADVISOR)
    target_uid = _client.get("/api/auth/me", headers=_auth(target_tok)).json()["user_id"]
    admin_tok = _login(ADMIN)

    r = _client.post(f"/api/auth/users/{target_uid}/revoke-sessions", headers=_auth(admin_tok))
    assert r.status_code == 200
    assert r.json()["user_id"] == target_uid

    assert _client.get("/api/auth/me", headers=_auth(target_tok)).status_code == 401


def test_non_admin_cannot_revoke_another_users_sessions():
    """The action that matters most to lock down: anyone able to call this on
    an arbitrary user_id could force-logout anyone in the system."""
    target_tok = _login(ADVISOR)
    target_uid = _client.get("/api/auth/me", headers=_auth(target_tok)).json()["user_id"]
    non_admin_tok = _login(SOUTHERN_ADVISOR)

    r = _client.post(f"/api/auth/users/{target_uid}/revoke-sessions",
                       headers=_auth(non_admin_tok))
    assert r.status_code == 403
    # And the target's session must genuinely be untouched, not just the
    # request rejected while some side effect still landed.
    assert _client.get("/api/auth/me", headers=_auth(target_tok)).status_code == 200


def test_admin_revoke_on_unknown_user_is_404():
    admin_tok = _login(ADMIN)
    r = _client.post("/api/auth/users/USR-does-not-exist/revoke-sessions",
                       headers=_auth(admin_tok))
    assert r.status_code == 404
