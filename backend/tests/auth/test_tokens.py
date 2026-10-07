"""
Phase 2 — the signing key, and the shape of the tokens signed with it.

Before this phase an unset JWT_SECRET silently meant "sign with the key that is
printed in the source". Anyone who had read the repository could mint a
platform_admin token against any deployment that forgot to set one, and the
public /api/health endpoint even reported whether that was the case. These tests
pin the replacement: a key that is never published, refusal to start without a
real one in production, and tokens that must carry — and prove — who issued them
and who they are for.
"""

from __future__ import annotations

import logging
import time

import jwt
import pytest

from app.auth.principal import issue_token
from app.config import settings

from .helpers import bearer, claims_of, make_user, sign, token_for

OLD_PUBLISHED_KEY = "autosaarthi-dev-secret-change-me"
REQUIRED_CLAIMS = ("exp", "iat", "sub", "org", "role", "tv", "jti", "iss", "aud", "amr", "scp")


@pytest.fixture
def dev_key_file(tmp_path, monkeypatch):
    """Send the generated dev key to a temp file so no test writes under data/."""
    path = tmp_path / "dev.key"
    monkeypatch.setattr(settings, "jwt_dev_key_file", str(path))
    return path


def _env(monkeypatch, *, secret: str, environment: str) -> None:
    monkeypatch.setattr(settings, "jwt_secret", secret)
    monkeypatch.setattr(settings, "environment", environment)


# ── the key ────────────────────────────────────────────────────────────────

def test_a_token_forged_with_the_old_published_key_is_rejected(client, monkeypatch, dev_key_file):
    # The attack: read the repo, learn the key and the admin's user id (derived
    # from the address), sign a token for a deployment that never set JWT_SECRET.
    # The forgery is copied from a real token so its ONLY flaw is the key.
    claims = claims_of(token_for(client, "admin@autosaarthi.io"))
    forged = sign(claims, OLD_PUBLISHED_KEY)

    _env(monkeypatch, secret="", environment="development")
    r = client.get("/api/auth/me", headers=bearer(forged))
    assert r.status_code == 401, "a token signed with the published dev key was accepted"


def test_rotating_the_key_invalidates_every_outstanding_token(client, monkeypatch):
    tok = token_for(client, "admin@autosaarthi.io")
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 200
    monkeypatch.setattr(settings, "jwt_secret", "a-completely-different-key-" + "y" * 24)
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 401


def test_production_refuses_to_run_without_a_signing_key(monkeypatch, dev_key_file):
    from app.auth import keys

    _env(monkeypatch, secret="", environment="production")
    with pytest.raises(keys.SigningKeyError, match="JWT_SECRET"):
        keys.validate_auth_config()
    with pytest.raises(keys.SigningKeyError):
        keys.signing_key()


@pytest.mark.parametrize("environment", ["development", "production"])
@pytest.mark.parametrize("secret", ["short", "x" * 31, OLD_PUBLISHED_KEY],
                         ids=["too-short", "one-char-short", "published-dev-key"])
def test_an_explicit_but_weak_secret_is_refused_everywhere(monkeypatch, dev_key_file,
                                                          secret, environment):
    # Setting a bad key is a mistake to surface, never something to quietly accept.
    from app.auth import keys

    _env(monkeypatch, secret=secret, environment=environment)
    with pytest.raises(keys.SigningKeyError):
        keys.validate_auth_config()


@pytest.mark.parametrize("environment", ["development", "production"])
def test_a_strong_secret_is_used_verbatim_and_raises_no_warning(monkeypatch, dev_key_file,
                                                               environment):
    from app.auth import keys

    secret = "s3cure-" + "k" * 40
    _env(monkeypatch, secret=secret, environment=environment)
    assert keys.validate_auth_config() == []
    assert keys.signing_key() == secret
    assert not dev_key_file.exists(), "a configured key must not create a dev key file"


def test_development_generates_a_random_key_instead_of_using_a_published_one(
        monkeypatch, dev_key_file):
    from app.auth import keys

    _env(monkeypatch, secret="", environment="development")
    warnings = keys.validate_auth_config()
    key = keys.signing_key()

    assert key != OLD_PUBLISHED_KEY and len(key) >= 32
    assert key == keys.signing_key(), "the key must be stable within a process"
    assert warnings and "JWT_SECRET" in warnings[0]


def test_the_generated_dev_key_survives_a_restart(monkeypatch, dev_key_file):
    # Otherwise every reload in development would log every user out.
    from app.auth import keys

    _env(monkeypatch, secret="", environment="development")
    first = keys.signing_key()
    keys.reset_cache()                       # what a restart does to process memory
    assert keys.signing_key() == first
    assert dev_key_file.read_text().strip() == first


def test_a_damaged_dev_key_file_is_replaced_not_trusted(monkeypatch, dev_key_file):
    from app.auth import keys

    _env(monkeypatch, secret="", environment="development")
    dev_key_file.write_text("abc")           # truncated / hand-edited
    key = keys.signing_key()
    assert len(key) >= 32 and key != "abc"


def test_the_dev_key_file_is_never_read_in_production(monkeypatch, dev_key_file):
    from app.auth import keys

    _env(monkeypatch, secret="", environment="development")
    keys.signing_key()                       # creates the file
    assert dev_key_file.exists()             # so it is there to be tempted by
    keys.reset_cache()
    _env(monkeypatch, secret="", environment="production")
    with pytest.raises(keys.SigningKeyError):
        keys.signing_key()


def test_the_generated_key_is_never_logged(monkeypatch, dev_key_file, caplog):
    from app.auth import keys

    _env(monkeypatch, secret="", environment="development")
    with caplog.at_level(logging.DEBUG):
        keys.validate_auth_config()
        key = keys.signing_key()
    assert key not in caplog.text


def test_the_app_refuses_to_start_when_the_auth_config_is_fatal(monkeypatch):
    # The check has to be wired into startup, not merely exist.
    from fastapi.testclient import TestClient

    from app import main

    class Sentinel(Exception):
        pass

    def boom():
        raise Sentinel

    monkeypatch.setattr(main, "validate_auth_config", boom)
    with pytest.raises(Sentinel):
        with TestClient(main.app):
            pass


# ── the token ──────────────────────────────────────────────────────────────

def _token_claims(client) -> dict:
    u = make_user()
    return claims_of(token_for(client, u["email"], u["password"]))


def test_issued_tokens_carry_issuer_audience_and_a_bounded_life(client):
    claims = _token_claims(client)
    assert claims["iss"] == "autosaarthi"
    assert claims["aud"] == "autosaarthi-api"
    for name in REQUIRED_CLAIMS:
        assert name in claims, f"issued token lacks {name!r}"
    assert 0 < claims["exp"] - claims["iat"] <= 12 * 3600


@pytest.mark.parametrize("missing", REQUIRED_CLAIMS)
def test_a_correctly_signed_token_missing_a_required_claim_is_rejected(client, missing):
    # Signed with the REAL key, so the only thing wrong is the missing claim. A
    # token with no `exp` in particular would otherwise be valid forever.
    claims = _token_claims(client)
    claims.pop(missing, None)
    r = client.get("/api/auth/me", headers=bearer(sign(claims, settings.jwt_secret)))
    assert r.status_code == 401, f"a token without {missing!r} was accepted"


@pytest.mark.parametrize("claim,value", [("iss", "someone-else"), ("aud", "another-service")])
def test_a_token_meant_for_another_issuer_or_audience_is_rejected(client, claim, value):
    claims = _token_claims(client)
    claims[claim] = value
    r = client.get("/api/auth/me", headers=bearer(sign(claims, settings.jwt_secret)))
    assert r.status_code == 401


def test_an_expired_token_is_rejected(client):
    claims = _token_claims(client)
    claims["exp"] = int(time.time()) - 10
    r = client.get("/api/auth/me", headers=bearer(sign(claims, settings.jwt_secret)))
    assert r.status_code == 401


def test_an_unsigned_token_is_rejected(client):
    claims = _token_claims(client)
    unsigned = jwt.encode(claims, key="", algorithm="none")
    assert client.get("/api/auth/me", headers=bearer(unsigned)).status_code == 401


def test_only_the_configured_algorithm_is_accepted(client):
    claims = _token_claims(client)
    other = sign(claims, settings.jwt_secret, "HS512")   # right key, wrong algorithm
    assert client.get("/api/auth/me", headers=bearer(other)).status_code == 401


def test_a_token_still_works_when_nothing_is_wrong_with_it(client):
    # The control for every rejection above: same construction, unmodified.
    claims = _token_claims(client)
    r = client.get("/api/auth/me", headers=bearer(sign(claims, settings.jwt_secret)))
    assert r.status_code == 200


def test_a_token_straight_from_issue_token_is_accepted(client):
    u = make_user()
    tok, _ = issue_token(u["id"], "ORG-CUSTOMERS", "vehicle_owner", 0, amr=["password"])
    assert client.get("/api/auth/me", headers=bearer(tok)).status_code == 200
