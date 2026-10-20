"""
How a notification reaches the mobile app.

Senders behind one interface, chosen by configuration — the same shape as the
SMS senders (app/auth/sms.py):

  console   writes the notification to the server log, so development needs no
            account. Never a production channel: the log line carries
            appointment details.
  expo      Expo's push service, which hands each message to FCM (Android) or
            APNs (iOS) using the app's own credentials, uploaded to Expo.
  disabled  what you get when neither is usable; sending raises.

The app registers where it can be reached (app/api_devices.py). A device is
forgotten when its user's sessions are ended — signing out must also stop the
notifications — or when Expo reports the app was uninstalled.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Protocol

import httpx
from sqlalchemy import text
from sqlalchemy.engine import Connection

from app.config import settings
from app.db.session import engine

log = logging.getLogger("autosaarthi.push")

PLATFORMS = ("android", "ios")
# What Expo's getExpoPushTokenAsync hands the app. Anything else is not a
# token any sender here could use.
TOKEN_PATTERN = r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,160}\]$"
# One account's phones, tablets and reinstalls. A client registering token
# after token must not grow the table without bound; the oldest go first.
MAX_DEVICES = 10


class PushConfigurationError(RuntimeError):
    """Push is configured in a way that cannot work."""


class PushDeliveryError(RuntimeError):
    """The push service did not take the messages. Never carries credentials or content."""


@dataclass(frozen=True)
class PushMessage:
    to: str
    title: str
    body: str
    data: dict = field(default_factory=dict)


class PushSender(Protocol):
    def send(self, messages: list[PushMessage]) -> set[str]:
        """Deliver; returns the tokens of phones that no longer have the app."""
        ...


def hint(token: str) -> str:
    """Enough of a token to tell two devices apart, not enough to push to one."""
    return token.rstrip("]")[-4:]


class DisabledPushSender:
    def send(self, messages: list[PushMessage]) -> set[str]:
        raise PushConfigurationError("push delivery is not configured")


class ConsolePushSender:
    def send(self, messages: list[PushMessage]) -> set[str]:
        for m in messages:
            log.warning("DEV-ONLY PUSH (not actually sent) to …%s: %s — %s",
                        hint(m.to), m.title, m.body)
        return set()


class ExpoPushSender:
    URL = "https://exp.host/--/api/v2/push/send"
    BATCH = 100                     # Expo's limit per request

    def __init__(self, access_token: str = "", *, client: httpx.Client | None = None,
                 timeout_s: float = 10.0) -> None:
        self._token = access_token
        self._client = client or httpx.Client(timeout=timeout_s)

    def send(self, messages: list[PushMessage]) -> set[str]:
        gone: set[str] = set()
        for start in range(0, len(messages), self.BATCH):
            gone |= self._send_batch(messages[start:start + self.BATCH])
        return gone

    def _send_batch(self, batch: list[PushMessage]) -> set[str]:
        headers = {"Accept": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        payload = [{"to": m.to, "title": m.title, "body": m.body, "data": m.data,
                    "sound": "default"} for m in batch]
        try:
            response = self._client.post(self.URL, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            # Only the exception's type: its text can carry the URL or headers.
            raise PushDeliveryError(
                f"could not reach the push service ({type(exc).__name__})") from None
        if response.status_code >= 300:
            raise PushDeliveryError(
                f"the push service rejected the request (HTTP {response.status_code})")
        try:
            tickets = response.json().get("data") or []
        except ValueError:
            raise PushDeliveryError("the push service sent a reply that is not JSON") from None
        # Tickets come back in message order. Only DeviceNotRegistered means the
        # app is gone; any other error is about this message, not the phone.
        return {m.to for m, t in zip(batch, tickets)
                if t.get("status") == "error"
                and (t.get("details") or {}).get("error") == "DeviceNotRegistered"}


# ── configuration ───────────────────────────────────────────────────────────

def push_available() -> bool:
    provider = settings.push_provider
    if provider == "none":
        return False
    return not (provider == "console" and settings.is_production)


def validate_push_config() -> list[str]:
    """Startup check: warnings, never a refusal to start — push is a secondary channel."""
    if settings.push_provider == "console" and settings.is_production:
        return ["PUSH_PROVIDER=console cannot be used in production, so app notifications "
                "are off. Configure expo, or set PUSH_PROVIDER=none."]
    return []


_cached: dict[str, PushSender] = {}


def get_push_sender() -> PushSender:
    """Tests replace this with a fake (monkeypatch the module attribute)."""
    if not push_available():
        return DisabledPushSender()
    provider = settings.push_provider
    if provider not in _cached:
        _cached[provider] = (ConsolePushSender() if provider == "console"
                             else ExpoPushSender(settings.expo_access_token))
    return _cached[provider]


# ── devices ─────────────────────────────────────────────────────────────────

def register(conn: Connection, user_id: str, token: str, platform: str) -> int:
    """Upsert by token: a token already on file moves to whoever registered it last."""
    device_id = conn.execute(text(
        "INSERT INTO push_devices (user_id, token, platform, created_at, last_seen_at) "
        "VALUES (:u, :t, :p, now(), now()) "
        "ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, "
        "platform = EXCLUDED.platform, last_seen_at = now(), "
        "created_at = CASE WHEN push_devices.user_id = EXCLUDED.user_id "
        "THEN push_devices.created_at ELSE now() END "
        "RETURNING id"), {"u": user_id, "t": token, "p": platform}).scalar_one()
    conn.execute(text(
        "DELETE FROM push_devices WHERE user_id = :u AND id NOT IN ("
        "SELECT id FROM push_devices WHERE user_id = :u "
        "ORDER BY last_seen_at DESC, id DESC LIMIT :n)"), {"u": user_id, "n": MAX_DEVICES})
    return device_id


def devices_for(conn: Connection, user_id: str) -> list:
    return conn.execute(text(
        "SELECT id, token, platform, created_at, last_seen_at FROM push_devices "
        "WHERE user_id = :u ORDER BY last_seen_at DESC"), {"u": user_id}).all()


def forget(conn: Connection, user_id: str, device_id: int) -> bool:
    return conn.execute(text("DELETE FROM push_devices WHERE id = :d AND user_id = :u "
                             "RETURNING id"), {"d": device_id, "u": user_id}).first() is not None


def forget_all_for_user(conn: Connection, user_id: str) -> None:
    conn.execute(text("DELETE FROM push_devices WHERE user_id = :u"), {"u": user_id})


# ── delivery ────────────────────────────────────────────────────────────────

def notify_customer(customer_id: str | None, title: str, body: str,
                    data: dict | None = None) -> dict:
    """What notify.push does. Reports, never raises: a push-service outage must
    not crash the agent run that wanted to send."""
    if not customer_id:
        return {"sent": False, "reason": "no customer", "devices": 0}
    with engine.connect() as c:
        customer = c.execute(text("SELECT user_id, consent_push FROM customers WHERE id = :c"),
                             {"c": customer_id}).first()
        if customer is None:
            return {"sent": False, "reason": "no customer", "devices": 0}
        if not customer.consent_push:
            return {"sent": False, "reason": "no consent", "devices": 0}
        tokens = [d.token for d in devices_for(c, customer.user_id)] if customer.user_id else []
    if not tokens:
        return {"sent": False, "reason": "no device", "devices": 0}

    messages = [PushMessage(to=t, title=title, body=body, data=data or {}) for t in tokens]
    try:
        gone = get_push_sender().send(messages)
    except (PushDeliveryError, PushConfigurationError) as exc:
        return {"sent": False, "reason": str(exc), "devices": 0}

    if gone:
        with engine.begin() as c:
            c.execute(text("DELETE FROM push_devices WHERE token = ANY(:t)"), {"t": list(gone)})
    delivered = len(tokens) - len(gone)
    if delivered == 0:
        return {"sent": False, "reason": "no device", "devices": 0}
    return {"sent": True, "devices": delivered}
