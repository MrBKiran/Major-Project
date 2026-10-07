"""
Google sign-in: checking the ID token Google Identity Services hands the browser.

Google's own library does the cryptography — RS256 signature against Google's
published certificates, expiry, and the issuer being Google. What is added here is
what that library leaves to the caller: the AUDIENCE (a token minted for some other
app must not sign anyone into this one), a strict reading of the claims we rely on,
and a cache for Google's certificates so a sign-in is not a network round trip to
Google and an outage there does not take sign-in down with it.

Two failure classes are kept apart on purpose. A bad token is the caller's problem
(401); Google being unreachable is not (503) — reporting it as an invalid credential
would tell a legitimate user their sign-in is wrong when the fault is ours.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Protocol

from google.auth import exceptions as google_exceptions
from google.oauth2 import id_token

from app.config import settings


# google-auth's default tolerance is ZERO, so a token Google issued a second "in the future"
# by our clock is rejected as "used too early" — an intermittent failure that looks like a bad
# credential. Ten seconds is Google's own guidance; far more would widen the replay window.
CLOCK_SKEW_S = 10


class GoogleVerificationError(Exception):
    """The credential is not a valid Google ID token for this application."""


class GoogleUnavailable(Exception):
    """Google could not be reached to check the credential."""


@dataclass(frozen=True)
class GoogleClaims:
    sub: str                 # Google's stable id for the account — what we bind to
    email: str
    email_verified: bool
    name: str | None = None


class GoogleVerifier(Protocol):
    def verify(self, credential: str) -> GoogleClaims: ...


class _CertCache:
    """Caches successful GETs (Google's certificate list) for a while.

    Google rotates its signing keys on the order of days and publishes a new key
    well before it signs with it, so a short TTL is safe. Failures are never
    cached: once Google is back, the next sign-in works.
    """

    def __init__(self, transport, ttl_s: float, clock) -> None:
        self._transport, self._ttl, self._clock = transport, ttl_s, clock
        self._entries: dict[str, tuple[float, object]] = {}

    def __call__(self, url, method="GET", body=None, headers=None, timeout=None, **kwargs):
        cacheable = method == "GET"
        if cacheable:
            hit = self._entries.get(url)
            if hit and self._clock() - hit[0] < self._ttl:
                return hit[1]
        response = self._transport(url, method=method, body=body, headers=headers,
                                   timeout=timeout, **kwargs)
        if cacheable and getattr(response, "status", None) == 200:
            self._entries[url] = (self._clock(), response)
        return response


class GoogleIdTokenVerifier:
    """Verifies a Google ID token with google-auth.

    `transport` is how Google's certificates are fetched; tests pass one that serves
    a local certificate, so the real verification path runs with no network.
    """

    def __init__(self, *, transport=None, clock=time.monotonic, cert_ttl_s: float = 1800) -> None:
        if transport is None:
            from google.auth.transport import requests as google_requests

            transport = google_requests.Request()
        self._transport = _CertCache(transport, cert_ttl_s, clock)

    def verify(self, credential: str) -> GoogleClaims:
        audience = settings.google_client_id
        if not audience:
            raise GoogleVerificationError("google sign-in is not configured")
        # Structural check first, so garbage never costs a fetch of Google's keys.
        parts = credential.split(".") if isinstance(credential, str) else []
        if len(parts) != 3 or not all(parts):
            raise GoogleVerificationError("not a JWT")

        try:
            info = id_token.verify_oauth2_token(
                credential, self._transport, audience=audience,
                clock_skew_in_seconds=CLOCK_SKEW_S)
        except google_exceptions.TransportError as exc:
            raise GoogleUnavailable("could not reach Google to check the token") from exc
        except (ValueError, google_exceptions.GoogleAuthError) as exc:
            # Signature, audience, issuer, expiry, unknown key id, unsupported alg...
            raise GoogleVerificationError(str(exc)) from exc

        sub, email = info.get("sub"), info.get("email")
        if not isinstance(sub, str) or not sub or not isinstance(email, str) or not email:
            raise GoogleVerificationError("token carries no subject or email")
        name = info.get("name")
        return GoogleClaims(
            sub=sub,
            email=email.strip().lower(),
            # Only the JSON boolean true means Google verified the address. "true",
            # 1 or an absent claim must not be read as verification.
            email_verified=info.get("email_verified") is True,
            name=name if isinstance(name, str) else None,
        )


_default: GoogleIdTokenVerifier | None = None


def get_google_verifier() -> GoogleVerifier:
    """FastAPI dependency. Tests replace it with a fake via dependency_overrides."""
    global _default
    if _default is None:
        _default = GoogleIdTokenVerifier()
    return _default
