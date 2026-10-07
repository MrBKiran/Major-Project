"""Fixtures for the auth suite only."""

from __future__ import annotations

import hashlib

import pytest

from app.auth import principal
from tests.conftest import FAST_PBKDF2_ITERATIONS

# Read at import, i.e. during collection — before the fixture below (or the
# bootstrap's seeding) lowers it — so a test can still assert on the real value.
_PRODUCTION_ITERATIONS = principal.PBKDF2_ITERATIONS


@pytest.fixture(autouse=True)
def _cheap_hashing(monkeypatch):
    monkeypatch.setattr(principal, "PBKDF2_ITERATIONS", FAST_PBKDF2_ITERATIONS)


@pytest.fixture(scope="session")
def production_iterations() -> int:
    return _PRODUCTION_ITERATIONS


@pytest.fixture
def sms(monkeypatch):
    """Phone sign-in switched on, with a FakeSmsSender recording what would be texted."""
    from app.auth.sms import get_sms_sender
    from app.config import settings
    from app.main import app

    from .fakes import FakeSmsSender

    fake = FakeSmsSender()
    monkeypatch.setattr(settings, "sms_provider", "console")     # available outside production
    app.dependency_overrides[get_sms_sender] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_sms_sender, None)


@pytest.fixture
def no_otp_throttling(monkeypatch):
    """For tests that need several codes in a row: lift the send limits, keep everything else."""
    from app.auth import ratelimit

    lifted = ratelimit.Limit(max_calls=10**6, window_s=1)
    for name in ("OTP_RESEND_COOLDOWN", "OTP_REQUEST_PER_PHONE", "OTP_REQUEST_PER_PHONE_DAY",
                 "OTP_REQUEST_PER_IP"):
        monkeypatch.setattr(ratelimit, name, lifted)


@pytest.fixture
def clock(monkeypatch):
    """Control the time TOTP codes are checked against.

    A code can be used once, so a test that enrols and then signs in needs the second
    code to come from a LATER 30-second step — hence a clock it can advance.
    """
    import time

    import pyotp

    from app.auth import mfa

    class Clock:
        offset = 0.0

        def now(self) -> float:
            return time.time() + self.offset

        def advance(self, seconds: float) -> None:
            self.offset += seconds

        def code(self, secret: str, *, at: float | None = None) -> str:
            return pyotp.TOTP(secret).at(self.now() if at is None else at)

    c = Clock()
    monkeypatch.setattr(mfa, "now", c.now)
    return c


TEST_GOOGLE_CLIENT_ID = "test-client-1234.apps.googleusercontent.com"


@pytest.fixture
def google(monkeypatch):
    """Google sign-in switched on, with a FakeGoogle standing in for Google."""
    from app.auth.google import get_google_verifier
    from app.config import settings
    from app.main import app

    from .fakes import FakeGoogle

    fake = FakeGoogle()
    monkeypatch.setattr(settings, "google_client_id", TEST_GOOGLE_CLIENT_ID)
    app.dependency_overrides[get_google_verifier] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_google_verifier, None)


@pytest.fixture
def pbkdf2_calls(monkeypatch) -> list[int]:
    """Records the iteration count of every PBKDF2 derivation, in order.

    Counting derivations is how the login timing tests assert "the same work
    was done" — a wall-clock comparison would be flaky, and this is exactly
    the property that closes the account-enumeration oracle.
    """
    calls: list[int] = []
    real = hashlib.pbkdf2_hmac

    def counting(hash_name, password, salt, iterations, *args, **kwargs):
        calls.append(iterations)
        return real(hash_name, password, salt, iterations, *args, **kwargs)

    monkeypatch.setattr(hashlib, "pbkdf2_hmac", counting)
    return calls
