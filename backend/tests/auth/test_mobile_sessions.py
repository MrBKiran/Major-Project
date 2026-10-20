"""
Sessions for the native app (Phase 3).

A phone app has no browser cookie jar worth trusting, so it gets its refresh
token in the response body and keeps it in the OS keystore. That must not
weaken the web: the httpOnly cookie exists so script on the page can never
hold a refresh token, and an endpoint that would hand the cookie's successor
back in a body would undo that. So every token family is bound to the client
that started it — `web` (cookie only) or `mobile` (body only) — and neither is
accepted the other way.
"""

from __future__ import annotations

from sqlalchemy import text

from app.auth import refresh as refresh_module
from app.db.session import engine

from .helpers import bearer, login, make_customer, make_user, new_phone

MOBILE = {"X-Client": "mobile"}
COOKIE = refresh_module.COOKIE_NAME


def mobile_login(client, u):
    return client.post("/api/auth/login", json={"email": u["email"], "password": u["password"]},
                       headers=MOBILE)


def mobile_refresh(client, token):
    return client.post("/api/auth/refresh", json={"refresh_token": token}, headers=MOBILE)


def _age(raw: str, seconds: int) -> None:
    with engine.begin() as c:
        c.execute(text("UPDATE refresh_tokens SET used_at = used_at - make_interval(secs => :s) "
                       "WHERE token_hash = :h"), {"s": seconds, "h": refresh_module._hash(raw)})


# ── signing in ──────────────────────────────────────────────────────────────

def test_the_app_gets_its_refresh_token_in_the_body_and_no_cookie(client):
    r = mobile_login(client, make_user())
    assert r.status_code == 200
    assert r.json()["refresh_token"]
    assert COOKIE not in r.headers.get("set-cookie", "")
    assert client.cookies.get(COOKIE) is None


def test_the_browser_still_gets_a_cookie_and_no_token_in_the_body(client):
    r = login(client, make_user()["email"])
    assert r.json().get("refresh_token") is None
    assert client.cookies.get(COOKIE)


def test_an_unknown_client_type_is_refused(client):
    u = make_user()
    r = client.post("/api/auth/login", json={"email": u["email"], "password": u["password"]},
                    headers={"X-Client": "smart-fridge"})
    assert r.status_code == 400


def test_phone_code_sign_in_works_for_the_app(client, sms):
    # Owners sign in on the phone with a texted code more than anything else.
    u = make_user()
    c = make_customer(new_phone(), user_id=u["id"])
    assert client.post("/api/auth/otp/request", json={"phone": c["phone"]}).status_code == 202
    code = sms.codes_for(c["e164"])[-1]
    r = client.post("/api/auth/otp/verify", json={"phone": c["phone"], "code": code}, headers=MOBILE)
    assert r.status_code == 200
    assert r.json()["refresh_token"]
    assert client.cookies.get(COOKIE) is None


# ── refreshing ──────────────────────────────────────────────────────────────

def test_the_app_refreshes_with_its_token_and_gets_the_next_one(client):
    first = mobile_login(client, make_user()).json()["refresh_token"]
    r = mobile_refresh(client, first)
    assert r.status_code == 200
    nxt = r.json()["refresh_token"]
    assert nxt and nxt != first
    assert r.json()["access_token"]
    assert COOKIE not in r.headers.get("set-cookie", "")


def test_a_replayed_app_token_burns_the_session(client):
    body = mobile_login(client, make_user()).json()
    stolen, access = body["refresh_token"], body["access_token"]
    assert mobile_refresh(client, stolen).status_code == 200
    _age(stolen, refresh_module.REUSE_GRACE_S + 30)
    assert mobile_refresh(client, stolen).status_code == 401
    assert client.get("/api/auth/me", headers=bearer(access)).status_code == 401


def test_a_quick_second_refresh_from_the_app_is_a_race_not_theft(client):
    body = mobile_login(client, make_user()).json()
    token, access = body["refresh_token"], body["access_token"]
    assert mobile_refresh(client, token).status_code == 200
    assert mobile_refresh(client, token).status_code == 409
    assert client.get("/api/auth/me", headers=bearer(access)).status_code == 200


def test_logout_ends_the_apps_refresh_token_too(client):
    body = mobile_login(client, make_user()).json()
    client.post("/api/auth/logout", headers=bearer(body["access_token"]))
    assert mobile_refresh(client, body["refresh_token"]).status_code == 401


# ── the two kinds never cross ───────────────────────────────────────────────

def test_a_browser_cookie_value_is_not_accepted_in_a_body(client):
    login(client, make_user()["email"])
    cookie_value = client.cookies.get(COOKIE)
    r = mobile_refresh(client, cookie_value)
    assert r.status_code == 401
    # …and refusing it did not burn the browser's session.
    assert client.post("/api/auth/refresh").status_code == 200


def test_an_app_token_is_not_accepted_as_a_cookie(client):
    token = mobile_login(client, make_user()).json()["refresh_token"]
    client.cookies.set(COOKIE, token)
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.clear()
    assert mobile_refresh(client, token).status_code == 200


def test_script_on_the_web_page_cannot_get_a_token_it_can_read(client):
    # The attack the binding exists for: page script can make the browser send
    # the httpOnly cookie, and can set any header. It must still never receive
    # a refresh token in a body.
    login(client, make_user()["email"])
    before = client.cookies.get(COOKIE)
    r = client.post("/api/auth/refresh", headers=MOBILE)
    assert r.json().get("refresh_token") is None
    # The header changed nothing: this was an ordinary cookie refresh. (Checked
    # separately because the client binding would also refuse a cookie token in
    # body mode — the first version of this test passed with the header deciding
    # the mode, carried by that other layer.)
    assert r.status_code == 200
    assert client.cookies.get(COOKIE) not in (None, before)


def test_a_garbage_app_token_is_refused_without_touching_cookies(client):
    r = mobile_refresh(client, "x" * 43)
    assert r.status_code == 401
    assert COOKIE not in r.headers.get("set-cookie", "")
