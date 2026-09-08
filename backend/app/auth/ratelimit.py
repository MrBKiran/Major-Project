"""
Request rate limiting.

Two separate concerns, deliberately not one shared limiter:

  * Login attempts, keyed on client IP AND on the account being targeted.
    Keying on IP alone lets a distributed attacker grind one account; keying on
    the account alone lets an attacker lock a victim out by failing their login
    on purpose. Both keys are checked, and only FAILED attempts count, so a
    legitimate user is never locked out by their own successful logins.

  * Authenticated API calls, keyed on the principal.

In-process fixed-window counters. That is honest about what this is: it is
per-worker, so N workers allow N times the limit, and it resets on restart. For
a single-node deployment it is real protection; for a multi-node one the same
interface should be backed by Redis, which is why the check is behind a
function rather than inlined into the routes.
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass


@dataclass(frozen=True)
class Limit:
    max_calls: int
    window_s: int


# Tight, because a password guess is cheap and a legitimate human logs in rarely.
LOGIN_PER_IP = Limit(max_calls=50, window_s=300)   # shared-NAT backstop
LOGIN_PER_ACCOUNT = Limit(max_calls=5, window_s=300)

# Generous, because a dashboard polling several panels is normal traffic.
API_PER_PRINCIPAL = Limit(max_calls=600, window_s=60)

# Expensive endpoints get their own budget: a defect-cluster run scans the whole
# parc and fits a statistical test per cohort.
HEAVY_PER_PRINCIPAL = Limit(max_calls=20, window_s=60)


class _Windows:
    def __init__(self) -> None:
        self._hits: dict[str, list[float]] = defaultdict(list)

    def _live(self, key: str, limit: Limit, now: float) -> list[float]:
        hits = [t for t in self._hits[key] if t > now - limit.window_s]
        self._hits[key] = hits
        return hits

    def peek(self, key: str, limit: Limit) -> tuple[bool, int]:
        """Check without consuming. Used where only failures should count."""
        now = time.monotonic()
        hits = self._live(key, limit, now)
        if len(hits) >= limit.max_calls:
            return False, int(limit.window_s - (now - hits[0])) + 1
        return True, 0

    def consume(self, key: str, limit: Limit) -> None:
        now = time.monotonic()
        self._live(key, limit, now).append(now)

    def check(self, key: str, limit: Limit) -> tuple[bool, int]:
        """Check and consume in one step."""
        allowed, retry = self.peek(key, limit)
        if allowed:
            self.consume(key, limit)
        return allowed, retry

    def clear(self, key: str) -> None:
        self._hits.pop(key, None)

    def reset(self) -> None:
        self._hits.clear()


_windows = _Windows()


def check_login(ip: str, email: str) -> tuple[bool, int]:
    """Read-only pre-check. Consumes nothing.

    Only FAILED attempts consume budget (see record_login_failure). Consuming
    on every attempt meant a valid login could be refused because of unrelated
    failures from the same address — and since the IP bucket is shared across
    accounts, one person fumbling their password on a corporate NAT or mobile
    CGNAT would have locked out everyone behind it.
    """
    ok_ip, retry_ip = _windows.peek(f"login:ip:{ip}", LOGIN_PER_IP)
    ok_acct, retry_acct = _windows.peek(f"login:acct:{email.lower()}", LOGIN_PER_ACCOUNT)
    if not ok_ip or not ok_acct:
        return False, max(retry_ip, retry_acct)
    return True, 0


def record_login_failure(ip: str, email: str) -> None:
    _windows.consume(f"login:ip:{ip}", LOGIN_PER_IP)
    _windows.consume(f"login:acct:{email.lower()}", LOGIN_PER_ACCOUNT)


def clear_login(ip: str, email: str) -> None:
    """A successful login clears that ACCOUNT's failure budget, so a user who
    mistypes twice and then succeeds is not throttled afterwards.

    The IP budget is deliberately NOT cleared: an attacker spraying passwords
    across many accounts would otherwise reset the shared backstop every time
    they happened to guess one correctly.
    """
    _windows.clear(f"login:acct:{email.lower()}")


def check_principal(user_id: str, heavy: bool = False) -> tuple[bool, int]:
    limit = HEAVY_PER_PRINCIPAL if heavy else API_PER_PRINCIPAL
    bucket = "heavy" if heavy else "api"
    return _windows.check(f"{bucket}:{user_id}", limit)


def reset() -> None:
    """Test hook."""
    _windows.reset()
