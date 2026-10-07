"""Which sign-in methods this deployment offers right now.

Password is always offered. The others exist only when they can actually work:
Google needs a client id, and phone codes need a way to deliver them. The login
screen builds its buttons from this (via GET /api/auth/config), so it never
shows one that would fail.

This is about what the DEPLOYMENT can do. Which methods a given ROLE may use is
separate, and lives in access_policy.yaml.
"""

from __future__ import annotations

from app.config import settings


def sms_available() -> bool:
    provider = settings.sms_provider
    if provider == "console":
        # The console sender writes the code to the server log — a development
        # convenience, and never acceptable as a real deployment's SMS channel.
        return not settings.is_production
    if provider == "twilio":
        return bool(settings.twilio_account_sid and settings.twilio_auth_token
                    and settings.twilio_from)
    return False


def available_methods() -> list[str]:
    methods = ["password"]
    if settings.google_client_id:
        methods.append("google")
    if sms_available():
        methods.append("phone_otp")
    return methods
