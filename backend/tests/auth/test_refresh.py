"""
Phase 7: short-lived access tokens + a rotating, httpOnly refresh cookie.

A bearer token that lives twelve hours in localStorage is a standing prize for
anything that can run script on the page. The access token is now short-lived
(15 minutes, same as the existing mfa_enroll scope); a refresh token — never
readable from JavaScript — silently mints the next one. It rotates on every
use, and presenting one that was already rotated away (replay of a stolen
cookie after the real client moved on) kills the whole chain, not just that
one token.
"""

from __future__ import annotations

from sqlalchemy import text

from app.auth import refresh as refresh_module
from app.config import settings
from app.db.session import engine

from .helpers import bearer, login, make_user, token_for
from .mfa_helpers import PRIVILEGED, enrolled_user, sign_in_with_totp


def _refresh_cookie_value(response) -> str | None:
    raw = response.headers.get("set-cookie", "")
    if not raw.startswith(f"{refresh_module.COOKIE_NAME}="):
        return None
    return raw.split(";")[0].split("=", 1)[1]


# ── the cookie itself ────────────────────────────────────────────────────────

def test_login_sets_an_httponly_refresh_cookie(client):
    u = make_user()
    r = login(client, u["email"], u["password"])
    set_cookie = r.headers.get("set-cookie", "").lower()
    assert "refresh_token=" in set_cookie
    assert "httponly" in set_cookie
    assert "samesite=lax" in set_cookie
    assert "path=/api/auth" in set_cookie


def test_the_access_token_is_now_short_lived(client):
    u = make_user()
    r = login(client, u["email"], u["password"])
    assert r.json()["expires_in"] == 15 * 60


def test_an_enrolment_only_session_gets_no_refresh_cookie(client, monkeypatch):
    monkeypatch.setattr(settings, "mfa_enforcement", True)
    u = make_user(memberships=PRIVILEGED)
    r = login(client, u["email"], u["password"])
    assert r.json()["next_step"] == "mfa_enroll"
    assert _refresh_cookie_value(r) is None
    assert client.cookies.get(refresh_module.COOKIE_NAME) is None


def test_mfa_verify_also_sets_a_refresh_cookie(client, clock):
    u = enrolled_user(client, clock)
    r = sign_in_with_totp(client, u, clock)
    assert r.status_code == 200
    assert _refresh_cookie_value(r) is not None


# ── rotation ─────────────────────────────────────────────────────────────────

def test_refresh_issues_a_new_access_token_and_rotates_the_cookie(client):
    u = make_user()
    login(client, u["email"], u["password"])
    old_refresh = client.cookies.get(refresh_module.COOKIE_NAME)

    r = client.post("/api/auth/refresh")
    assert r.status_code == 200
    assert r.json()["access_token"]

    new_refresh = client.cookies.get(refresh_module.COOKIE_NAME)
    assert new_refresh and new_refresh != old_refresh


def test_the_refreshed_token_keeps_the_same_membership_and_amr(client):
    u = make_user()
    login_body = login(client, u["email"], u["password"]).json()
    r = client.post("/api/auth/refresh")
    assert r.json()["principal"]["org"] == login_body["principal"]["org"]
    assert r.json()["principal"]["role"] == login_body["principal"]["role"]


def _age_rotation(raw: str, seconds: int) -> None:
    """Pretend `raw` was rotated `seconds` ago."""
    with engine.begin() as c:
        c.execute(text("UPDATE refresh_tokens SET used_at = used_at - make_interval(secs => :s) "
                       "WHERE token_hash = :h"), {"s": seconds, "h": refresh_module._hash(raw)})


def test_reusing_an_already_rotated_refresh_token_revokes_the_whole_family(client):
    u = make_user()
    r = login(client, u["email"], u["password"])
    access = r.json()["access_token"]
    stolen = client.cookies.get(refresh_module.COOKIE_NAME)

    # the legitimate client rotates once; its access token still works
    assert client.post("/api/auth/refresh").status_code == 200
    assert client.get("/api/auth/me", headers=bearer(access)).status_code == 200

    # an attacker replays the pre-rotation cookie — later than any race could explain
    _age_rotation(stolen, refresh_module.REUSE_GRACE_S + 30)
    client.cookies.set(refresh_module.COOKIE_NAME, stolen)
    reused = client.post("/api/auth/refresh")
    assert reused.status_code == 401

    # the whole chain is burned — even the legitimate side is signed out
    assert client.get("/api/auth/me", headers=bearer(access)).status_code == 401


# ── two refreshes at once is a race, not a theft ────────────────────────────
# Found live: a page reload while a refresh was in flight sent the same cookie
# twice in one second, and reuse detection signed the user out everywhere. Two
# open tabs do the same. Every browser tab shares one cookie jar, so the loser
# of the race already HAS the winner's new cookie — it only has to retry.

def _race(client):
    u = make_user()
    r = login(client, u["email"], u["password"])
    access, old = r.json()["access_token"], client.cookies.get(refresh_module.COOKIE_NAME)
    winner = client.post("/api/auth/refresh")
    assert winner.status_code == 200
    newer = client.cookies.get(refresh_module.COOKIE_NAME)
    client.cookies.set(refresh_module.COOKIE_NAME, old)
    loser = client.post("/api/auth/refresh")
    return access, newer, loser


def test_a_second_refresh_moments_later_is_told_to_retry(client):
    _, _, loser = _race(client)
    assert loser.status_code == 409
    assert "access_token" not in loser.json()


def test_a_race_does_not_burn_the_session(client):
    access, newer, _ = _race(client)
    assert client.get("/api/auth/me", headers=bearer(access)).status_code == 200
    client.cookies.set(refresh_module.COOKIE_NAME, newer)
    assert client.post("/api/auth/refresh").status_code == 200


def test_a_dead_refresh_cookie_is_cleared(client):
    # Found while testing the race: the refusal raised HTTPException, which
    # builds a new response and silently dropped the cookie deletion.
    client.cookies.set(refresh_module.COOKIE_NAME, "not-a-real-refresh-token")
    refused = client.post("/api/auth/refresh")
    set_cookie = refused.headers.get("set-cookie", "")
    assert refused.status_code == 401
    assert set_cookie.startswith(f"{refresh_module.COOKIE_NAME}=") and "Max-Age=0" in set_cookie


def test_the_loser_of_a_race_does_not_delete_the_winners_cookie(client):
    _, _, loser = _race(client)
    assert refresh_module.COOKIE_NAME not in loser.headers.get("set-cookie", "")


def test_refresh_without_a_cookie_is_refused(client):
    assert client.post("/api/auth/refresh").status_code == 401


def test_refresh_with_garbage_is_refused(client):
    client.cookies.set(refresh_module.COOKIE_NAME, "not-a-real-refresh-token")
    assert client.post("/api/auth/refresh").status_code == 401


def test_an_expired_refresh_token_is_refused(client):
    u = make_user()
    login(client, u["email"], u["password"])
    raw = client.cookies.get(refresh_module.COOKIE_NAME)
    with engine.begin() as c:
        c.execute(
            text("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute' "
                 "WHERE token_hash = :h"),
            {"h": refresh_module._hash(raw)},
        )
    assert client.post("/api/auth/refresh").status_code == 401


# ── it is revoked everywhere a session already is ────────────────────────────

def test_logout_revokes_the_refresh_token_too(client):
    # Captured from the login response itself, not read back from the cookie jar
    # afterwards — logout's delete_cookie() clears the jar client-side regardless
    # of whether the token was actually revoked server-side, which would make a
    # test that only checks "the cookie jar is now empty" pass for the wrong
    # reason. This proves the token is dead even if an attacker kept a copy.
    u = make_user()
    r = login(client, u["email"], u["password"])
    access = r.json()["access_token"]
    stolen = _refresh_cookie_value(r)
    assert stolen

    client.post("/api/auth/logout", headers=bearer(access))

    client.cookies.set(refresh_module.COOKIE_NAME, stolen)
    assert client.post("/api/auth/refresh").status_code == 401


def test_changing_password_revokes_the_old_refresh_token(client):
    u = make_user()
    r = login(client, u["email"], u["password"])
    access = r.json()["access_token"]
    old_refresh = client.cookies.get(refresh_module.COOKIE_NAME)

    client.post("/api/auth/password/change",
               json={"current_password": u["password"],
                     "new_password": "Another-Str0ng-Passphrase-9"},
               headers=bearer(access))

    client.cookies.set(refresh_module.COOKIE_NAME, old_refresh)
    assert client.post("/api/auth/refresh").status_code == 401


def test_admin_revoking_a_users_sessions_also_revokes_their_refresh_token(client):
    victim = make_user()
    r = login(client, victim["email"], victim["password"])
    victim_refresh = _refresh_cookie_value(r)
    assert victim_refresh

    admin = token_for(client, "admin@autosaarthi.io")   # overwrites the shared cookie jar
    client.post(f"/api/auth/users/{victim['id']}/revoke-sessions", headers=bearer(admin))

    client.cookies.set(refresh_module.COOKIE_NAME, victim_refresh)
    assert client.post("/api/auth/refresh").status_code == 401


def test_deactivating_a_user_revokes_their_refresh_token(client):
    from app.auth.manage import set_active

    u = make_user()
    r = login(client, u["email"], u["password"])
    victim_refresh = _refresh_cookie_value(r)
    assert victim_refresh

    set_active(u["email"], False)

    client.cookies.set(refresh_module.COOKIE_NAME, victim_refresh)
    assert client.post("/api/auth/refresh").status_code == 401
