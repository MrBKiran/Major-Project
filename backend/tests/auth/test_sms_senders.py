"""
Phase 5 — how a one-time code reaches a phone.

Three senders behind one interface: a console sender so development needs no
provider account, Twilio for real delivery, and a disabled one for when neither is
usable. Which one is used is decided by configuration, and the rules that matter are
about what must NOT happen: the console sender (which writes the code to the log)
must never be a production channel, and a provider failure must never leak the
credentials it was called with.
"""

from __future__ import annotations

import logging
from urllib.parse import parse_qs

import httpx
import pytest

from app.config import settings

SID, TOKEN = "AC" + "1" * 32, "twilio-secret-token-value"


def _twilio(handler, sender="+15005550006"):
    from app.auth.sms import TwilioSmsSender

    client = httpx.Client(transport=httpx.MockTransport(handler))
    return TwilioSmsSender(SID, TOKEN, sender, client=client)


# ── choosing a sender ──────────────────────────────────────────────────────

@pytest.mark.parametrize("provider,environment,creds,expected", [
    ("console", "development", False, "ConsoleSmsSender"),
    ("console", "test", False, "ConsoleSmsSender"),
    ("console", "production", False, "DisabledSmsSender"),    # never a production channel
    ("none", "development", False, "DisabledSmsSender"),
    ("twilio", "production", False, "DisabledSmsSender"),     # chosen but not configured
    ("twilio", "production", True, "TwilioSmsSender"),
])
def test_the_sender_follows_the_configuration(monkeypatch, provider, environment, creds, expected):
    from app.auth import sms

    monkeypatch.setattr(sms, "_cached", {})
    monkeypatch.setattr(settings, "sms_provider", provider)
    monkeypatch.setattr(settings, "environment", environment)
    monkeypatch.setattr(settings, "twilio_account_sid", SID if creds else "")
    monkeypatch.setattr(settings, "twilio_auth_token", TOKEN if creds else "")
    monkeypatch.setattr(settings, "twilio_from", "+15005550006" if creds else "")
    assert type(sms.get_sms_sender()).__name__ == expected


def test_a_disabled_sender_refuses_to_send():
    from app.auth.sms import DisabledSmsSender, SmsConfigurationError

    with pytest.raises(SmsConfigurationError):
        DisabledSmsSender().send("+919811820044", "hello")


# ── the console sender ─────────────────────────────────────────────────────

def test_the_console_sender_writes_the_message_to_the_log(caplog):
    from app.auth.sms import ConsoleSmsSender

    with caplog.at_level(logging.INFO):
        ConsoleSmsSender().send("+919811820044", "Your code is 123456")
    assert "123456" in caplog.text                   # the whole point, in development
    assert "DEV" in caplog.text.upper()              # and it says so
    assert "+919811820044" not in caplog.text        # the number is masked even here


# ── Twilio ─────────────────────────────────────────────────────────────────

def test_twilio_receives_the_message_in_the_shape_its_api_expects():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(method=request.method, path=request.url.path, host=request.url.host,
                    auth=request.headers.get("authorization"),
                    form=parse_qs(request.content.decode()))
        return httpx.Response(201, json={"sid": "SM123"})

    _twilio(handler).send("+919811820044", "Your code is 123456")

    assert (seen["method"], seen["host"]) == ("POST", "api.twilio.com")
    assert seen["path"] == f"/2010-04-01/Accounts/{SID}/Messages.json"
    assert seen["auth"].startswith("Basic ")
    assert seen["form"] == {"To": ["+919811820044"], "From": ["+15005550006"],
                            "Body": ["Your code is 123456"]}


def test_a_messaging_service_sid_is_sent_as_such():
    seen = {}

    def handler(request):
        seen["form"] = parse_qs(request.content.decode())
        return httpx.Response(201, json={})

    _twilio(handler, sender="MG" + "a" * 32).send("+919811820044", "x")
    assert "MessagingServiceSid" in seen["form"] and "From" not in seen["form"]


@pytest.mark.parametrize("status", [400, 401, 429, 500])
def test_a_provider_error_raises_without_leaking_credentials_or_content(status):
    from app.auth.sms import SmsDeliveryError

    with pytest.raises(SmsDeliveryError) as err:
        _twilio(lambda r: httpx.Response(status, text=f"denied {TOKEN}")).send(
            "+919811820044", "Your code is 123456")
    message = str(err.value)
    assert str(status) in message
    for secret in (TOKEN, SID, "123456", "+919811820044"):
        assert secret not in message


def test_a_network_failure_raises_a_delivery_error():
    from app.auth.sms import SmsDeliveryError

    def handler(request):
        raise httpx.ConnectError("boom", request=request)

    with pytest.raises(SmsDeliveryError) as err:
        _twilio(handler).send("+919811820044", "x")
    assert TOKEN not in str(err.value)


# ── the message text ───────────────────────────────────────────────────────

def test_the_message_carries_the_code_and_the_lifetime(monkeypatch):
    from app.auth.sms import render_message

    monkeypatch.setattr(settings, "otp_ttl_s", 300)
    body = render_message("482913")
    assert "482913" in body and "5 minutes" in body


def test_a_custom_template_is_used_verbatim(monkeypatch):
    # In India the operator must have this exact text registered (DLT).
    from app.auth.sms import render_message

    monkeypatch.setattr(settings, "otp_sms_template", "AutoSaarthi OTP: {code}")
    assert render_message("111222") == "AutoSaarthi OTP: 111222"


def test_startup_refuses_a_template_that_cannot_carry_the_code(monkeypatch):
    from app.auth.sms import SmsConfigurationError, validate_sms_config

    monkeypatch.setattr(settings, "otp_sms_template", "Your code is on its way")
    with pytest.raises(SmsConfigurationError, match="code"):
        validate_sms_config()


def test_startup_warns_when_production_would_fall_back_to_the_console(monkeypatch):
    from app.auth.sms import validate_sms_config

    monkeypatch.setattr(settings, "environment", "production")
    monkeypatch.setattr(settings, "sms_provider", "console")
    warnings = validate_sms_config()
    assert warnings and "phone" in warnings[0].lower()


def test_startup_is_quiet_when_the_configuration_is_fine(monkeypatch):
    from app.auth.sms import validate_sms_config

    monkeypatch.setattr(settings, "environment", "development")
    monkeypatch.setattr(settings, "sms_provider", "console")
    assert validate_sms_config() == []


def test_the_app_refuses_to_start_when_the_sms_configuration_is_fatal(monkeypatch):
    from fastapi.testclient import TestClient

    from app import main

    class Sentinel(Exception):
        pass

    def boom():
        raise Sentinel

    monkeypatch.setattr(main, "validate_sms_config", boom)
    with pytest.raises(Sentinel):
        with TestClient(main.app):
            pass
