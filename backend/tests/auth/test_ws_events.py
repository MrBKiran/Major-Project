"""
Phase 2 — /ws/events used to stream every event to whoever connected.

That stream carries red-team runs, UEBA quarantines and job activity, and it
required no credentials at all: the HTTP side was locked down while this side
door stood open. Browsers cannot set an Authorization header on a WebSocket, and
a token in the URL would end up in access logs and proxies, so the credential is
the first message on the socket. Until it arrives and checks out, nothing is sent.

Close codes follow the 4xxx application range, mirroring HTTP: 4401 for "who are
you" (missing, malformed, expired, revoked) and 4403 for "known, but not allowed".
"""

from __future__ import annotations

import uuid

import pytest
from starlette.websockets import WebSocketDisconnect

from app.config import settings
from app.events import bus

from .helpers import bump_token_version, claims_of, make_user, set_active, sign, token_for

from .ws_helpers import FORBIDDEN, UNAUTHENTICATED, auth_message, close_code, connect, recv


@pytest.fixture
def quick_timeout(monkeypatch):
    monkeypatch.setattr(settings, "ws_auth_timeout_s", 0.4)


# ── nothing flows until the credential checks out ──────────────────────────

def test_nothing_is_sent_to_a_connection_that_has_not_authenticated(client, quick_timeout):
    bus.emit_nowait({"type": "test-marker", "n": uuid.uuid4().hex})
    assert close_code(client) == UNAUTHENTICATED


@pytest.mark.parametrize("email", ["soc@autosaarthi.io", "admin@autosaarthi.io"])
def test_an_authorised_analyst_is_acknowledged_then_receives_the_replay(client, email):
    marker = uuid.uuid4().hex
    bus.emit_nowait({"type": "test-marker", "n": marker})
    tok = token_for(client, email)

    with connect(client) as ws:
        ws.send_json(auth_message(tok))
        assert recv(ws) == {"type": "auth_ok"}
        # The marker was emitted last, so it is the final frame of the replay.
        for _ in range(101):
            if recv(ws).get("n") == marker:
                break
        else:
            pytest.fail("the replayed history never reached the analyst")


@pytest.mark.parametrize("org,role", [
    ("ORG-CUSTOMERS", "vehicle_owner"),
    ("ORG-RAMAN", "fleet_manager"),
    ("ORG-WESTERN", "service_advisor"),
    ("ORG-WESTERN", "centre_manager"),
    ("ORG-MAHINDRA", "oem_quality_engineer"),
    ("ORG-MAHINDRA", "oem_quality_manager"),
])
def test_a_role_without_ueba_read_is_forbidden(client, org, role):
    u = make_user(memberships=[(org, role)])
    tok = token_for(client, u["email"], u["password"])
    assert close_code(client, auth_message(tok)) == FORBIDDEN


# ── every way of failing to authenticate ends the same way ─────────────────

@pytest.mark.parametrize("message", [
    {"type": "auth"},
    {"type": "auth", "token": ""},
    {"type": "auth", "token": "not-a-jwt"},
    {"type": "auth", "token": None},
    {"type": "auth", "token": 12345},
    {"type": "hello", "token": "anything"},
    ["auth", "token"],
    "just a string",
], ids=["no-token", "empty-token", "garbage-token", "null-token", "numeric-token",
        "wrong-type", "json-array", "json-string"])
def test_a_malformed_first_message_is_refused(client, message):
    assert close_code(client, message) == UNAUTHENTICATED


def test_a_first_message_that_is_not_json_is_refused(client):
    assert close_code(client, raw="{not json") == UNAUTHENTICATED


def test_an_oversized_first_message_is_refused(client):
    assert close_code(client, raw="x" * 200_000) == UNAUTHENTICATED


def test_a_token_signed_with_the_wrong_key_is_refused(client):
    claims = claims_of(token_for(client, "soc@autosaarthi.io"))
    assert close_code(client, auth_message(sign(claims, "not-the-servers-key-" + "z" * 24))) \
        == UNAUTHENTICATED


def test_an_expired_token_is_refused(client):
    claims = claims_of(token_for(client, "soc@autosaarthi.io"))
    claims["exp"] = claims["iat"] - 60
    assert close_code(client, auth_message(sign(claims, settings.jwt_secret))) == UNAUTHENTICATED


def test_a_revoked_token_is_refused(client):
    u = make_user(memberships=[("ORG-PLATFORM", "security_analyst")])
    tok = token_for(client, u["email"], u["password"])
    bump_token_version(u["id"])                       # what logout / an admin revoke does
    assert close_code(client, auth_message(tok)) == UNAUTHENTICATED


def test_a_token_for_a_deactivated_user_is_refused(client):
    u = make_user(memberships=[("ORG-PLATFORM", "security_analyst")])
    tok = token_for(client, u["email"], u["password"])
    set_active(u["id"], False)
    assert close_code(client, auth_message(tok)) == FORBIDDEN


def test_silence_is_not_a_way_to_hold_the_socket_open(client, quick_timeout):
    assert close_code(client) == UNAUTHENTICATED


# ── an open stream does not outlive the credential ─────────────────────────

def test_an_open_stream_is_cut_when_its_token_is_revoked(client, monkeypatch):
    monkeypatch.setattr(settings, "ws_recheck_s", 0.2)
    u = make_user(memberships=[("ORG-PLATFORM", "security_analyst")])
    tok = token_for(client, u["email"], u["password"])

    with connect(client) as ws:
        ws.send_json(auth_message(tok))
        assert recv(ws) == {"type": "auth_ok"}
        bump_token_version(u["id"])
        with pytest.raises(WebSocketDisconnect) as closed:
            for _ in range(500):                      # drain the replay until the cut
                recv(ws)
    assert closed.value.code == UNAUTHENTICATED


def test_an_open_stream_is_cut_when_the_user_is_deactivated(client, monkeypatch):
    monkeypatch.setattr(settings, "ws_recheck_s", 0.2)
    u = make_user(memberships=[("ORG-PLATFORM", "security_analyst")])
    tok = token_for(client, u["email"], u["password"])

    with connect(client) as ws:
        ws.send_json(auth_message(tok))
        assert recv(ws) == {"type": "auth_ok"}
        set_active(u["id"], False)
        with pytest.raises(WebSocketDisconnect) as closed:
            for _ in range(500):
                recv(ws)
    assert closed.value.code == FORBIDDEN
