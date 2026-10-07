"""
Phase 4 — Google's ID-token verification, exercised with a REAL RS256 token.

The endpoint tests use a fake verifier; this file is what makes that safe. It builds
a genuine signed token with a locally generated key, serves the matching certificate
through a fake transport (no network), and runs it through the real google-auth
verification — so signature, audience, issuer and expiry are checked by the code that
will check them in production, and every way a token can be wrong is shown to be
refused.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import json
import time
from types import SimpleNamespace

import jwt
import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID
from google.auth import exceptions as google_exceptions

from app.config import settings

CLIENT_ID = "verifier-test-1234.apps.googleusercontent.com"
KID = "test-key-1"


def _make_key_and_cert(cn: str = "google-test"):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, cn)])
    now = dt.datetime.now(dt.timezone.utc)
    cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
            .public_key(key.public_key()).serial_number(x509.random_serial_number())
            .not_valid_before(now - dt.timedelta(days=1))
            .not_valid_after(now + dt.timedelta(days=30))
            .sign(key, hashes.SHA256()))
    key_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                serialization.NoEncryption())
    return key_pem, cert.public_bytes(serialization.Encoding.PEM).decode()


@pytest.fixture(scope="module")
def signing():
    """(private key PEM, certificate PEM) Google would sign with and publish."""
    return _make_key_and_cert()


class FakeTransport:
    """A google-auth transport that 'downloads' our certificate instead of Google's."""

    def __init__(self, certs: dict[str, str] | None = None, error: Exception | None = None):
        self.certs, self.error, self.fetches = certs or {}, error, 0

    def __call__(self, url, method="GET", body=None, headers=None, timeout=None, **kwargs):
        self.fetches += 1
        if self.error:
            raise self.error
        return SimpleNamespace(status=200, headers={}, data=json.dumps(self.certs).encode())


def _token(key_pem, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1234567890",
        "email": "someone@example.com", "email_verified": True, "name": "Some One",
        "iat": now, "exp": now + 3600, **overrides,
    }
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, key_pem, algorithm="RS256", headers={"kid": KID})


def _hs256_token(secret: bytes, claims: dict, headers: dict) -> str:
    """Built by hand: PyJWT refuses to HMAC-sign with a certificate, which is exactly
    the guard an attacker would not have."""
    def b64(data: bytes) -> str:
        return base64.urlsafe_b64encode(data).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "HS256", "typ": "JWT", **headers}).encode())
    payload = b64(json.dumps(claims).encode())
    signature = b64(hmac.new(secret, f"{header}.{payload}".encode(), hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


@pytest.fixture
def verifier(signing, monkeypatch):
    from app.auth.google import GoogleIdTokenVerifier

    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    transport = FakeTransport({KID: signing[1]})
    v = GoogleIdTokenVerifier(transport=transport)
    v.transport = transport                       # exposed for the fetch-count assertions
    return v


# ── the good path ──────────────────────────────────────────────────────────

def test_a_genuine_token_yields_the_claims_we_use(verifier, signing):
    claims = verifier.verify(_token(signing[0]))
    assert (claims.sub, claims.email, claims.email_verified, claims.name) == \
        ("1234567890", "someone@example.com", True, "Some One")


def test_the_other_google_issuer_spelling_is_accepted(verifier, signing):
    assert verifier.verify(_token(signing[0], iss="accounts.google.com")).sub == "1234567890"


def test_the_audience_checked_is_the_configured_client_id(verifier, signing, monkeypatch):
    monkeypatch.setattr(settings, "google_client_id", "some-other-client.apps.googleusercontent.com")
    from app.auth.google import GoogleVerificationError

    with pytest.raises(GoogleVerificationError):
        verifier.verify(_token(signing[0]))              # minted for CLIENT_ID


# ── every way a token can be wrong ─────────────────────────────────────────

@pytest.mark.parametrize("overrides", [
    {"aud": "someone-elses-app.apps.googleusercontent.com"},   # meant for another app
    {"iss": "https://evil.example.com"},                        # not Google
    {"iss": "accounts.google.com.evil.example"},                # lookalike
    {"exp": int(time.time()) - 3600, "iat": int(time.time()) - 7200},   # expired
    {"sub": None},                                              # no subject
], ids=["wrong-audience", "wrong-issuer", "lookalike-issuer", "expired", "no-sub"])
def test_a_token_that_is_wrong_in_any_of_these_ways_is_refused(verifier, signing, overrides):
    from app.auth.google import GoogleVerificationError

    with pytest.raises(GoogleVerificationError):
        verifier.verify(_token(signing[0], **overrides))


def test_a_token_signed_by_someone_else_is_refused(verifier):
    from app.auth.google import GoogleVerificationError

    other_key, _ = _make_key_and_cert("attacker")
    with pytest.raises(GoogleVerificationError):
        verifier.verify(_token(other_key))               # same kid, different key


def test_a_token_with_an_unknown_key_id_is_refused(verifier, signing):
    from app.auth.google import GoogleVerificationError

    forged = jwt.encode({"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1",
                         "exp": int(time.time()) + 60}, signing[0], algorithm="RS256",
                        headers={"kid": "not-a-published-key"})
    with pytest.raises(GoogleVerificationError):
        verifier.verify(forged)


def test_the_certificate_cannot_be_used_as_an_hmac_secret(verifier, signing):
    # Algorithm confusion: sign with HS256 using the PUBLIC certificate as the
    # secret. A verifier that trusted the token's own `alg` would accept it.
    from app.auth.google import GoogleVerificationError

    forged = _hs256_token(
        signing[1].encode(),
        {"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1",
         "exp": int(time.time()) + 60},
        {"kid": KID})
    with pytest.raises(GoogleVerificationError):
        verifier.verify(forged)


def test_an_unsigned_token_is_refused(verifier):
    from app.auth.google import GoogleVerificationError

    unsigned = jwt.encode({"iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "1",
                           "exp": int(time.time()) + 60}, key="", algorithm="none",
                          headers={"kid": KID})
    with pytest.raises(GoogleVerificationError):
        verifier.verify(unsigned)


@pytest.mark.parametrize("junk", ["", "not.a.jwt", "a.b", "x" * 5000, "....", "eyJhbGciOiJub25lIn0."])
def test_garbage_is_refused_without_raising_anything_else(verifier, junk):
    from app.auth.google import GoogleVerificationError

    with pytest.raises(GoogleVerificationError):
        verifier.verify(junk)


def test_an_email_verified_claim_that_is_not_the_boolean_true_does_not_count(verifier, signing):
    # Only the JSON boolean true means Google verified the address. A string
    # "true", a 1 or a missing claim must not be read as verification.
    for value in ("true", 1, None, "yes"):
        claims = verifier.verify(_token(signing[0], email_verified=value))
        assert claims.email_verified is False, f"{value!r} was treated as verified"


# ── the outside world ──────────────────────────────────────────────────────

def test_a_failure_to_reach_google_is_reported_as_unavailable_not_as_a_bad_token(signing, monkeypatch):
    from app.auth.google import GoogleIdTokenVerifier, GoogleUnavailable

    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    v = GoogleIdTokenVerifier(transport=FakeTransport(error=google_exceptions.TransportError("down")))
    with pytest.raises(GoogleUnavailable):
        v.verify(_token(signing[0]))


def test_google_signing_keys_are_cached_between_verifications(verifier, signing):
    verifier.verify(_token(signing[0]))
    verifier.verify(_token(signing[0], sub="another"))
    assert verifier.transport.fetches == 1


def test_the_key_cache_expires(signing, monkeypatch):
    from app.auth.google import GoogleIdTokenVerifier

    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    clock = {"now": 1000.0}
    transport = FakeTransport({KID: signing[1]})
    v = GoogleIdTokenVerifier(transport=transport, clock=lambda: clock["now"])
    v.verify(_token(signing[0]))
    clock["now"] += 24 * 3600                       # a day later
    v.verify(_token(signing[0]))
    assert transport.fetches == 2


def test_a_failed_key_download_is_not_cached(signing, monkeypatch):
    from app.auth.google import GoogleIdTokenVerifier, GoogleUnavailable

    monkeypatch.setattr(settings, "google_client_id", CLIENT_ID)
    transport = FakeTransport(error=google_exceptions.TransportError("down"))
    v = GoogleIdTokenVerifier(transport=transport)
    with pytest.raises(GoogleUnavailable):
        v.verify(_token(signing[0]))
    transport.error, transport.certs = None, {KID: signing[1]}      # Google is back
    assert v.verify(_token(signing[0])).sub == "1234567890"


# ── clock skew ─────────────────────────────────────────────────────────────
# Found in review: google-auth defaults to ZERO tolerance, so a token Google issued a second
# "in the future" by our clock was rejected as "used too early" — an intermittent failure that
# looks like a bad credential to the person signing in.

def test_a_token_issued_a_few_seconds_ahead_of_our_clock_is_accepted(verifier, signing):
    now = int(time.time())
    assert verifier.verify(_token(signing[0], iat=now + 5, exp=now + 3600)).sub == "1234567890"


def test_a_token_from_the_far_future_is_still_refused(verifier, signing):
    from app.auth.google import GoogleVerificationError

    now = int(time.time())
    with pytest.raises(GoogleVerificationError):
        verifier.verify(_token(signing[0], iat=now + 600, exp=now + 4200))


def test_a_token_that_expired_long_ago_is_still_refused(verifier, signing):
    from app.auth.google import GoogleVerificationError

    now = int(time.time())
    with pytest.raises(GoogleVerificationError):
        verifier.verify(_token(signing[0], iat=now - 4000, exp=now - 400))
