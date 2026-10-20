"""
Push notifications (Phase 3): the phone says where it can be reached, and the
agents' notify.push — until now a stub that answered {"sent": True} without
sending anything — delivers there.

The register/forget routes are the mobile app's; the sender mirrors the SMS
one (app/auth/sms.py): a console sender for development that production
refuses, and Expo's push service for real delivery.
"""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from sqlalchemy import text

from app import push
from app.config import settings
from app.db.models import Customer
from app.db.session import SessionLocal, engine
from app.tools.core import PushArgs
from app.tools.core import push as notify_push
from app.tools.registry import ToolContext

from .auth.helpers import bearer, make_user, token_for

TOKEN = "ExponentPushToken[abcdefghij0123456789]"


def token(n: int) -> str:
    return f"ExponentPushToken[device{n:04d}xxxxxxxxxx]"


@pytest.fixture(autouse=True)
def _clean():
    yield
    with engine.begin() as c:
        c.execute(text("DELETE FROM push_devices"))
        c.execute(text("DELETE FROM customers WHERE id LIKE 'PUSHTEST%'"))


@pytest.fixture
def owner(client):
    user = make_user()
    return {**user, "access": token_for(client, user["email"])}


@pytest.fixture
def other(client):
    user = make_user()
    return {**user, "access": token_for(client, user["email"])}


def register(client, who, tok=TOKEN, platform="android"):
    return client.post("/api/me/devices", headers=bearer(who["access"]),
                       json={"token": tok, "platform": platform})


def devices(client, who) -> list[dict]:
    r = client.get("/api/me/devices", headers=bearer(who["access"]))
    assert r.status_code == 200, r.text
    return r.json()["devices"]


def stored_for(user_id: str) -> list[str]:
    with engine.connect() as c:
        return c.execute(text("SELECT token FROM push_devices WHERE user_id = :u"),
                         {"u": user_id}).scalars().all()


# ── registering the phone ───────────────────────────────────────────────────

def test_a_signed_in_phone_registers_where_it_can_be_reached(client, owner):
    r = register(client, owner)
    assert r.status_code == 200, r.text
    assert r.json()["platform"] == "android"
    listed = devices(client, owner)
    assert [d["platform"] for d in listed] == ["android"]


def test_the_list_never_hands_back_a_whole_token(client, owner):
    # Whoever holds the token can push to that phone.
    register(client, owner)
    r = client.get("/api/me/devices", headers=bearer(owner["access"]))
    assert TOKEN not in r.text
    assert r.json()["devices"][0]["hint"] == "6789"


def test_registering_again_keeps_one_device(client, owner):
    register(client, owner)
    register(client, owner)
    assert len(devices(client, owner)) == 1


def test_a_phone_belongs_to_whoever_signed_in_on_it_last(client, owner, other):
    # The handed-down phone: the previous owner must stop getting this one's alerts.
    register(client, owner)
    register(client, other)
    assert devices(client, owner) == []
    assert len(devices(client, other)) == 1


def test_registering_needs_a_session(client):
    r = client.post("/api/me/devices", json={"token": TOKEN, "platform": "android"})
    assert r.status_code == 401


@pytest.mark.parametrize("body", [
    {"token": "hello", "platform": "android"},
    {"token": "ExponentPushToken[]", "platform": "android"},
    {"token": "ExponentPushToken[" + "a" * 300 + "]", "platform": "android"},
    {"token": TOKEN, "platform": "windows"},
])
def test_only_push_tokens_from_known_platforms_are_accepted(client, owner, body):
    r = client.post("/api/me/devices", headers=bearer(owner["access"]), json=body)
    assert r.status_code == 422
    assert stored_for(owner["id"]) == []


def test_one_account_cannot_pile_up_devices(client, owner):
    for n in range(push.MAX_DEVICES + 2):
        assert register(client, owner, token(n)).status_code == 200
    kept = set(stored_for(owner["id"]))
    assert len(kept) == push.MAX_DEVICES
    assert token(0) not in kept and token(1) not in kept      # the oldest go
    assert token(push.MAX_DEVICES + 1) in kept


def test_a_device_can_be_forgotten(client, owner):
    device_id = register(client, owner).json()["id"]
    r = client.delete(f"/api/me/devices/{device_id}", headers=bearer(owner["access"]))
    assert r.status_code == 204
    assert devices(client, owner) == []


def test_nobody_can_forget_someone_elses_device(client, owner, other):
    device_id = register(client, owner).json()["id"]
    r = client.delete(f"/api/me/devices/{device_id}", headers=bearer(other["access"]))
    assert r.status_code == 404
    assert len(devices(client, owner)) == 1


# ── ending sessions ends the notifications ──────────────────────────────────

def test_signing_out_forgets_the_phone(client, owner):
    register(client, owner)
    assert client.post("/api/auth/logout", headers=bearer(owner["access"])).status_code == 200
    assert stored_for(owner["id"]) == []


def test_an_administrator_ending_someones_sessions_forgets_their_phone(client, owner):
    register(client, owner)
    admin = token_for(client, "admin@autosaarthi.io")
    r = client.post(f"/api/auth/users/{owner['id']}/revoke-sessions", headers=bearer(admin))
    assert r.status_code == 200, r.text
    assert stored_for(owner["id"]) == []


# ── notify.push delivers ────────────────────────────────────────────────────

class FakePushSender:
    def __init__(self) -> None:
        self.sent: list[push.PushMessage] = []
        self.uninstalled: set[str] = set()
        self.fail = False

    def send(self, messages: list[push.PushMessage]) -> set[str]:
        if self.fail:
            raise push.PushDeliveryError("could not reach the push service (ConnectError)")
        self.sent.extend(messages)
        return {m.to for m in messages} & self.uninstalled


@pytest.fixture
def sender(monkeypatch):
    fake = FakePushSender()
    monkeypatch.setattr(push, "get_push_sender", lambda: fake)
    return fake


def customer_of(user_id: str, *, consent: bool = True) -> str:
    cid = f"PUSHTEST{user_id[-6:]}"[:16]
    with SessionLocal() as s:
        s.add(Customer(id=cid, user_id=user_id, name="Push Test", consent_push=consent))
        s.commit()
    return cid


def notify(customer_id: str | None) -> dict:
    ctx = ToolContext(run_id="push-test", agent_id="customer_engagement_agent")
    args = PushArgs(customer_id=customer_id, title="Appointment confirmed", body="Tue 09:30",
                    deeplink="autosaarthi://appointments")
    return asyncio.run(notify_push(args, ctx))


def test_notify_push_reaches_the_owners_phone(client, owner, sender):
    register(client, owner)
    result = notify(customer_of(owner["id"]))
    assert result == {"sent": True, "devices": 1}
    [message] = sender.sent
    assert message.to == TOKEN and message.title == "Appointment confirmed"
    assert message.body == "Tue 09:30"
    assert message.data == {"deeplink": "autosaarthi://appointments"}


def test_notify_push_respects_a_refusal_of_notifications(client, owner, sender):
    register(client, owner)
    result = notify(customer_of(owner["id"], consent=False))
    assert result["sent"] is False and result["reason"] == "no consent"
    assert sender.sent == []


def test_notify_push_with_no_phone_registered_says_so(client, owner, sender):
    result = notify(customer_of(owner["id"]))
    assert result == {"sent": False, "reason": "no device", "devices": 0}


def test_notify_push_without_a_customer_says_so(sender):
    assert notify(None) == {"sent": False, "reason": "no customer", "devices": 0}


def test_a_phone_that_uninstalled_the_app_is_forgotten(client, owner, sender):
    register(client, owner)
    sender.uninstalled.add(TOKEN)
    notify(customer_of(owner["id"]))
    assert stored_for(owner["id"]) == []


def test_a_delivery_failure_is_reported_not_raised(client, owner, sender):
    # An outage at the push service must not crash the agent run that sent it.
    register(client, owner)
    sender.fail = True
    result = notify(customer_of(owner["id"]))
    assert result["sent"] is False and "ConnectError" in result["reason"]
    assert stored_for(owner["id"]) == [TOKEN]


# ── the Expo sender ─────────────────────────────────────────────────────────

def expo(handler, access_token: str = "") -> push.ExpoPushSender:
    return push.ExpoPushSender(access_token, client=httpx.Client(transport=httpx.MockTransport(handler)))


MESSAGE = push.PushMessage(to=TOKEN, title="Service due", body="Battery", data={"deeplink": "x"})


def test_expo_sender_posts_the_messages():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["json"] = json.loads(request.content)
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "r1"}]})

    assert expo(handler, "expo-secret").send([MESSAGE]) == set()
    assert seen["url"] == push.ExpoPushSender.URL
    assert seen["json"] == [{"to": TOKEN, "title": "Service due", "body": "Battery",
                             "data": {"deeplink": "x"}, "sound": "default"}]
    assert seen["auth"] == "Bearer expo-secret"


def test_expo_sender_sends_no_credential_it_was_not_given():
    seen = {}

    def handler(request):
        seen["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": [{"status": "ok", "id": "r1"}]})

    expo(handler).send([MESSAGE])
    assert seen["auth"] is None


def test_expo_reports_phones_that_uninstalled_the_app():
    def handler(request):
        return httpx.Response(200, json={"data": [{
            "status": "error", "message": "not registered",
            "details": {"error": "DeviceNotRegistered"}}]})

    assert expo(handler).send([MESSAGE]) == {TOKEN}


def test_expo_other_per_message_errors_do_not_forget_the_phone():
    def handler(request):
        return httpx.Response(200, json={"data": [{
            "status": "error", "message": "too big", "details": {"error": "MessageTooBig"}}]})

    assert expo(handler).send([MESSAGE]) == set()


def test_expo_unreachable_does_not_leak_the_url_or_credential():
    def handler(request):
        raise httpx.ConnectError(f"cannot reach {request.url} with expo-secret")

    with pytest.raises(push.PushDeliveryError) as err:
        expo(handler, "expo-secret").send([MESSAGE])
    assert "ConnectError" in str(err.value)
    assert "exp.host" not in str(err.value) and "expo-secret" not in str(err.value)


def test_expo_rejecting_the_request_is_a_delivery_error():
    with pytest.raises(push.PushDeliveryError, match="HTTP 500"):
        expo(lambda request: httpx.Response(500, text="boom")).send([MESSAGE])


# ── configuration ───────────────────────────────────────────────────────────

def test_console_push_is_refused_in_production(monkeypatch):
    # Its log line carries appointment details; a production log is no place for them.
    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "push_provider", "console")
    assert any("PUSH_PROVIDER=console" in w for w in push.validate_push_config())
    assert isinstance(push.get_push_sender(), push.DisabledPushSender)


def test_console_push_works_in_development(monkeypatch):
    monkeypatch.setattr(settings, "push_provider", "console")
    assert push.validate_push_config() == []
    assert isinstance(push.get_push_sender(), push.ConsolePushSender)


def test_push_can_be_switched_off(monkeypatch):
    monkeypatch.setattr(settings, "push_provider", "none")
    assert isinstance(push.get_push_sender(), push.DisabledPushSender)
