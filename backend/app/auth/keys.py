"""
The JWT signing key.

Until this module existed an unset JWT_SECRET silently meant "sign with the key
that is printed in the source". Anyone who had read the repository could mint a
platform_admin token — user ids are derived from the address, so even the `sub`
was guessable — against any deployment that forgot to set one. The rules now:

  * a configured key must be strong (>= 32 characters) and must not be one that
    has ever appeared in this repository, in every environment;
  * in production a missing key is fatal at startup — the app does not run;
  * in development a missing key is not fatal, but the app generates a random one
    instead of using a published one, and keeps it in a file so reloads do not
    log every developer out. The file is never read in production.

The generated key is never logged.

Limitation, deliberately accepted: the dev key file is written atomically but
two processes starting at the same instant could each generate one. That only
matters for multi-process setups, which are not development setups — and those
must set JWT_SECRET anyway, which is what production requires.
"""

from __future__ import annotations

import logging
import os
import secrets
from pathlib import Path

from app.config import settings

log = logging.getLogger("autosaarthi")

MIN_KEY_LENGTH = 32

# Keys that appear in this repository's source or history. Refused outright:
# a key that is public is not a secret however long it is.
_PUBLISHED_KEYS = frozenset({"autosaarthi-dev-secret-change-me"})

_DEFAULT_DEV_KEY_FILE = Path(__file__).resolve().parents[3] / "data" / ".jwt_dev_key"

_GENERATE_HINT = 'python -c "import secrets; print(secrets.token_urlsafe(48))"'

# Keyed by file path so a changed jwt_dev_key_file never serves a stale key.
_cache: dict[str, str] = {}


class SigningKeyError(RuntimeError):
    """The signing key is missing or unusable. The app must not run on it."""


def reset_cache() -> None:
    """Forget the in-memory dev key — what a process restart does. For tests."""
    _cache.clear()


def _dev_key_path() -> Path:
    configured = settings.jwt_dev_key_file
    return Path(configured) if configured else _DEFAULT_DEV_KEY_FILE


def _read_valid(path: Path) -> str | None:
    try:
        value = path.read_text(encoding="utf-8").strip()
    except OSError:
        return None
    return value if len(value) >= MIN_KEY_LENGTH else None


def _load_or_create_dev_key() -> str:
    path = _dev_key_path()
    cached = _cache.get(str(path))
    if cached:
        return cached

    key = _read_valid(path)
    if key is None:
        # Missing, truncated or hand-edited: replace rather than trust it.
        candidate = secrets.token_urlsafe(48)
        tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            # 0o600 from creation, so there is no window in which the key is
            # world-readable. (Windows ignores the mode; its ACLs apply.)
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(candidate)
            os.replace(tmp, path)        # atomic: never a half-written key
            key = _read_valid(path) or candidate
        except OSError as exc:
            log.warning("could not persist the generated dev signing key to %s (%s); "
                        "it will change on restart", path, type(exc).__name__)
            key = candidate
    _cache[str(path)] = key
    return key


def signing_key() -> str:
    secret = settings.jwt_secret
    if secret:
        if secret in _PUBLISHED_KEYS:
            raise SigningKeyError(
                "JWT_SECRET is the placeholder published in the source, so anyone can "
                f"mint tokens for it. Generate a real one with: {_GENERATE_HINT}")
        if len(secret) < MIN_KEY_LENGTH:
            raise SigningKeyError(
                f"JWT_SECRET is {len(secret)} characters; at least {MIN_KEY_LENGTH} are "
                f"required. Generate one with: {_GENERATE_HINT}")
        return secret

    if settings.is_production:
        raise SigningKeyError(
            f"JWT_SECRET is not set, and production will not run without one. "
            f"Generate one with: {_GENERATE_HINT}")
    return _load_or_create_dev_key()


def signing_key_source() -> str:
    """'configured' or 'generated' — for the operator-only health detail."""
    return "configured" if settings.jwt_secret else "generated"


def validate_auth_config() -> list[str]:
    """Startup check. Raises SigningKeyError if the app must not start; otherwise
    returns human-readable warnings for the log."""
    signing_key()                        # raises when missing (production) or weak
    warnings: list[str] = []
    if not settings.jwt_secret:
        warnings.append(
            f"JWT_SECRET is not set; using a generated development signing key "
            f"({_dev_key_path()}). Only processes sharing that file can verify each "
            f"other's tokens — set JWT_SECRET before running anything beyond a single "
            f"local process.")
    return warnings
