"""
How a one-time code reaches a phone.

Three senders behind one interface, chosen by configuration:

  console   writes the message to the server log. It exists so development needs no
            provider account — and because it puts the code in a log file it is never
            a production channel (see methods.sms_available).
  twilio    real delivery over Twilio's REST API.
  disabled  what you get when neither is usable; sending raises.

In India the operator must have the message text registered (TRAI DLT) or the SMS is
silently dropped, so the text is configuration (OTP_SMS_TEMPLATE), not code.
"""

from __future__ import annotations

import logging
from typing import Protocol

import httpx

from app.auth.methods import sms_available
from app.auth.phone import mask_phone
from app.config import settings

log = logging.getLogger("autosaarthi.sms")


class SmsConfigurationError(RuntimeError):
    """SMS is configured in a way that cannot work."""


class SmsDeliveryError(RuntimeError):
    """The provider did not accept the message. Never carries credentials or content."""


class SmsSender(Protocol):
    def send(self, to: str, body: str) -> None: ...


class DisabledSmsSender:
    def send(self, to: str, body: str) -> None:
        raise SmsConfigurationError("SMS delivery is not configured")


class ConsoleSmsSender:
    def send(self, to: str, body: str) -> None:
        # The number is masked even here; the body is not, because seeing the code is
        # the whole point of this sender.
        log.warning("DEV-ONLY SMS (not actually sent) to %s: %s", mask_phone(to), body)


class TwilioSmsSender:
    URL = "https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json"

    def __init__(self, account_sid: str, auth_token: str, sender: str, *,
                 client: httpx.Client | None = None, timeout_s: float = 10.0) -> None:
        self._sid, self._token, self._sender = account_sid, auth_token, sender
        self._client = client or httpx.Client(timeout=timeout_s)

    def send(self, to: str, body: str) -> None:
        data = {"To": to, "Body": body}
        # A Messaging Service SID ("MG...") replaces the From number.
        data["MessagingServiceSid" if self._sender.startswith("MG") else "From"] = self._sender
        try:
            response = self._client.post(self.URL.format(sid=self._sid), data=data,
                                         auth=(self._sid, self._token))
        except httpx.HTTPError as exc:
            # Only the exception's type: its text can carry the URL, and the URL
            # carries the account id.
            raise SmsDeliveryError(
                f"could not reach the SMS provider ({type(exc).__name__})") from None
        if response.status_code >= 300:
            raise SmsDeliveryError(
                f"the SMS provider rejected the message (HTTP {response.status_code})")


def render_message(code: str) -> str:
    return settings.otp_sms_template.format(code=code, minutes=max(1, settings.otp_ttl_s // 60))


def validate_sms_config() -> list[str]:
    """Startup check. Raises if the app must not start; otherwise returns warnings."""
    try:
        sample = render_message("000000")
    except (KeyError, IndexError, ValueError) as exc:
        raise SmsConfigurationError(
            f"OTP_SMS_TEMPLATE is not a valid template ({type(exc).__name__}); it may use "
            f"only {{code}} and {{minutes}}") from None
    if "000000" not in sample:
        raise SmsConfigurationError(
            "OTP_SMS_TEMPLATE must contain {code}, or the code never reaches the phone")

    warnings: list[str] = []
    provider = settings.sms_provider
    if provider == "console" and settings.is_production:
        warnings.append("SMS_PROVIDER=console cannot be used in production, so phone sign-in "
                        "is disabled. Configure twilio, or set SMS_PROVIDER=none.")
    if provider == "twilio" and not sms_available():
        warnings.append("SMS_PROVIDER=twilio but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / "
                        "TWILIO_FROM are not all set, so phone sign-in is disabled.")
    return warnings


_cached: dict[str, SmsSender] = {}


def get_sms_sender() -> SmsSender:
    """FastAPI dependency. Tests replace it with a fake via dependency_overrides.

    Never raises: it is evaluated before the route body, and a disabled deployment
    must answer 404 from the route, not 500 from here.
    """
    if not sms_available():
        return DisabledSmsSender()
    provider = settings.sms_provider
    if provider not in _cached:
        _cached[provider] = (
            ConsoleSmsSender() if provider == "console" else
            TwilioSmsSender(settings.twilio_account_sid, settings.twilio_auth_token,
                            settings.twilio_from))
    return _cached[provider]
