"""
Shared pytest harness for the backend suite.

Exists for one reason: the auth tests have to mint users, burn OTP challenges,
bump token versions and hammer the login limiter — none of which may touch the
database the demo runs on. So the suite gets its own database, recreated and
seeded from scratch each session.

Two consequences worth knowing:

  * Everything here runs the app IN-PROCESS (TestClient) rather than against a
    server on :8010. That is what allows a fake SMS sender and a fake Google
    verifier to be injected; neither is possible across a process boundary.
    (test_tenancy.py and test_auth_revocation.py still talk to a live server
    and are unaffected — they never import the app.)

  * `settings.database_url` is rewritten at import time of this file. That is
    only safe because pytest imports conftest.py before any test module in this
    directory, so nothing has yet imported app.db.session and built an engine
    against the demo database.
"""

from __future__ import annotations

import pytest
import psycopg
from sqlalchemy.engine import make_url

from app.config import settings

TEST_DB = "autosaarthi_test"
_LOCAL_HOSTS = {None, "", "localhost", "127.0.0.1", "::1"}

# A fixed signing key for the whole session, set before anything can start the
# app. Without it the first test to touch `client` would start the app's
# lifespan with no key configured, and the app would generate one and write it
# under data/ — a side effect no test run should have.
TEST_JWT_SECRET = "test-signing-secret-" + "x" * 32

# PBKDF2 at its production cost is ~0.5s per hash; the suite logs in hundreds of
# times, so hashing runs at a token cost here. Tests about the real cost read
# it before this is applied (see tests/auth/conftest.py).
FAST_PBKDF2_ITERATIONS = 1_000

_dev_url = make_url(settings.database_url)

# This file DROPs a database. Two independent guards so a misconfigured
# DATABASE_URL can never turn that into dropping something that matters.
if _dev_url.host not in _LOCAL_HOSTS:
    raise RuntimeError(
        f"refusing to run the test suite against non-local database host {_dev_url.host!r}")
if TEST_DB == "autosaarthi":  # pragma: no cover — a constant, guarded against edits
    raise RuntimeError("TEST_DB must never equal the demo database name")

_test_url = _dev_url.set(database=TEST_DB)
settings.database_url = _test_url.render_as_string(hide_password=False)
settings.environment = "test"          # never inherit ENVIRONMENT=production from a .env
settings.jwt_secret = TEST_JWT_SECRET


def _libpq_dsn(database: str) -> str:
    """A plain libpq URL (no SQLAlchemy driver suffix) for psycopg.connect."""
    return _test_url.set(drivername="postgresql", database=database).render_as_string(
        hide_password=False)


@pytest.fixture(scope="session", autouse=True)
def _bootstrap_database():
    """Recreate and seed the throwaway database once per session.

    Dropped-and-recreated rather than truncated so a previous run's leftovers
    (a deactivated user, a bumped token_version) can never make a test pass or
    fail depending on what ran before it.
    """
    with psycopg.connect(_libpq_dsn("postgres"), autocommit=True) as conn:
        conn.execute(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)')
        conn.execute(f'CREATE DATABASE "{TEST_DB}"')

    from app.auth import principal
    from app.db.seed import seed
    from app.db.tenancy_seed import seed_tenancy

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(principal, "PBKDF2_ITERATIONS", FAST_PBKDF2_ITERATIONS)
        seed()
        seed_tenancy()
    yield


@pytest.fixture(scope="session")
def db_engine(_bootstrap_database):
    from app.db.session import engine

    return engine


@pytest.fixture(scope="session")
def _app_client(_bootstrap_database):
    """One TestClient — and so one app lifespan — for the whole session.

    Starting the lifespan is not free (job workers, guard install, policy
    load), so it is done once and each test just gets a clean view of it.
    """
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as c:
        yield c


@pytest.fixture
def client(_app_client):
    """The shared client with no cookies or auth header carried over."""
    _app_client.cookies.clear()
    _app_client.headers.pop("Authorization", None)
    return _app_client


@pytest.fixture(autouse=True)
def _clean_process_state(monkeypatch):
    """Reset the state that lives in process memory and would otherwise leak.

    The login limiter is per-process by design (see auth/ratelimit.py), so
    without this a test that deliberately trips it would poison every test
    that logs in from the same address afterwards. The signing secret is pinned
    so tokens are deterministic to reason about; a test that needs it unset
    overrides this with its own monkeypatch.
    """
    from app.auth import ratelimit

    ratelimit.reset()
    monkeypatch.setattr(settings, "jwt_secret", TEST_JWT_SECRET)
    yield
