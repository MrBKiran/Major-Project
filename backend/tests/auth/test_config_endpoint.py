"""
Phase 3 — GET /api/auth/config, what the sign-in screen needs to know.

Public (there is nobody to authenticate yet), so it says which sign-in methods to
offer and nothing else. The Google client id is public by design — the browser
needs it to render the button — and appears only when Google sign-in is on.
"""

from __future__ import annotations

import pytest

from app.config import settings


def _config(client) -> dict:
    r = client.get("/api/auth/config")
    assert r.status_code == 200, r.text
    return r.json()


def test_config_is_public_and_reveals_only_what_the_login_screen_needs(client):
    assert set(_config(client)) == {"methods", "google_client_id", "mfa_enforced"}


def test_password_is_always_offered(client, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "")
    monkeypatch.setattr(settings, "sms_provider", "none")
    assert _config(client)["methods"] == ["password"]


def test_google_is_offered_only_when_a_client_id_is_configured(client, monkeypatch):
    monkeypatch.setattr(settings, "sms_provider", "none")
    monkeypatch.setattr(settings, "google_client_id", "")
    off = _config(client)
    assert "google" not in off["methods"] and off["google_client_id"] is None

    monkeypatch.setattr(settings, "google_client_id", "1234-abcd.apps.googleusercontent.com")
    on = _config(client)
    assert "google" in on["methods"]
    assert on["google_client_id"] == "1234-abcd.apps.googleusercontent.com"


@pytest.mark.parametrize("provider,environment,creds,expected", [
    ("console", "development", False, True),      # dev convenience: the code goes to the log
    ("console", "test", False, True),
    ("console", "production", False, False),      # never a real deployment's SMS channel
    ("none", "development", False, False),
    ("twilio", "production", False, False),       # chosen but not configured
    ("twilio", "production", True, True),
])
def test_phone_sign_in_follows_the_sms_provider(client, monkeypatch, provider, environment,
                                                creds, expected):
    monkeypatch.setattr(settings, "environment", environment)
    monkeypatch.setattr(settings, "sms_provider", provider)
    monkeypatch.setattr(settings, "twilio_account_sid", "ACtest" if creds else "")
    monkeypatch.setattr(settings, "twilio_auth_token", "token" if creds else "")
    monkeypatch.setattr(settings, "twilio_from", "+15005550006" if creds else "")
    assert ("phone_otp" in _config(client)["methods"]) is expected


def test_config_reports_whether_a_second_factor_is_enforced(client, monkeypatch):
    monkeypatch.setattr(settings, "mfa_enforcement", False)
    assert _config(client)["mfa_enforced"] is False
    monkeypatch.setattr(settings, "mfa_enforcement", True)
    assert _config(client)["mfa_enforced"] is True
