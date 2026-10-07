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

The keys include attacker-chosen text (the email typed into a login form, a phone number
in a code request), so the table itself must not be exhaustible. Found in review: checking
a limit used to create an entry for its key, so an unauthenticated client could grow the
table by one entry per request — refused ones included — until the process ran out of
memory. Now: checking never creates state; state exists only while a window is live;
expired state is swept; and there is a hard ceiling on the number of keys.
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Limit:
    max_calls: int
    window_s: int


# Tight, because a password guess is cheap and a legitimate human logs in rarely.
LOGIN_PER_IP = Limit(max_calls=50, window_s=300)   # shared-NAT backstop
LOGIN_PER_ACCOUNT = Limit(max_calls=5, window_s=300)

# Google sign-in has no per-account budget to key on before the token is verified,
# and a shared one would let anyone lock every Google user out by failing on
# purpose — so it is per source address only, and only failures spend it.
GOOGLE_PER_IP = Limit(max_calls=20, window_s=300)

# Guessing the CURRENT password through the change-password endpoint, e.g. with a
# stolen session. Its own bucket, not the login one: otherwise failing here would
# also lock the real owner out of signing in.
PASSWORD_CHANGE_PER_USER = Limit(max_calls=5, window_s=300)

# Second-factor codes: six digits is a million possibilities, so guesses are what to
# limit. Only FAILURES count, per account and per address — a user typing the right code
# is never throttled by their own attempts.
MFA_FAILURES_PER_USER = Limit(max_calls=5, window_s=300)
MFA_FAILURES_PER_IP = Limit(max_calls=30, window_s=300)

# Phone codes. Every request SENDS AN SMS THAT COSTS MONEY and lands on someone's
# phone, so unlike a login these consume budget whether or not anything goes wrong —
# and they apply identically to numbers that are not customers, so being throttled
# reveals nothing about whether a number is real.
OTP_RESEND_COOLDOWN = Limit(max_calls=1, window_s=30)
OTP_REQUEST_PER_PHONE = Limit(max_calls=3, window_s=900)
OTP_REQUEST_PER_PHONE_DAY = Limit(max_calls=10, window_s=86400)
OTP_REQUEST_PER_IP = Limit(max_calls=20, window_s=3600)
# Guesses are also capped per code (5); this bounds one address probing many numbers.
OTP_VERIFY_PER_IP = Limit(max_calls=30, window_s=900)

# Generous, because a dashboard polling several panels is normal traffic.
API_PER_PRINCIPAL = Limit(max_calls=600, window_s=60)

# Expensive endpoints get their own budget: a defect-cluster run scans the whole
# parc and fits a statistical test per cohort.
HEAVY_PER_PRINCIPAL = Limit(max_calls=20, window_s=60)


class _Windows:
    SWEEP_EVERY_S = 60.0
    # Generous for real traffic (each key is a few hundred bytes) and a hard stop for a flood.
    MAX_KEYS = 100_000

    def __init__(self, clock=time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, list[float]] = {}
        self._expires: dict[str, float] = {}      # key -> when its newest hit leaves its window
        self._last_sweep = clock()

    def size(self) -> int:
        return len(self._hits)

    def _forget(self, key: str) -> None:
        self._hits.pop(key, None)
        self._expires.pop(key, None)

    def _live(self, key: str, limit: Limit, now: float) -> list[float]:
        """The hits still inside the window. Read-only with respect to KEYS: an unknown key
        stays unknown, and a key whose hits have all aged out is dropped."""
        hits = self._hits.get(key)
        if not hits:
            return []
        live = [t for t in hits if t > now - limit.window_s]
        if len(live) != len(hits):
            if live:
                self._hits[key] = live
            else:
                self._forget(key)
        return live

    def peek(self, key: str, limit: Limit) -> tuple[bool, int]:
        """Check without consuming. Used where only failures should count."""
        now = self._clock()
        hits = self._live(key, limit, now)
        if len(hits) >= limit.max_calls:
            return False, int(limit.window_s - (now - hits[0])) + 1
        return True, 0

    def consume(self, key: str, limit: Limit) -> None:
        now = self._clock()
        self._hits[key] = [*self._live(key, limit, now), now]
        self._expires[key] = now + limit.window_s
        self._maintain(now)

    def _maintain(self, now: float) -> None:
        if now - self._last_sweep >= self.SWEEP_EVERY_S:
            self._sweep(now)
        if len(self._hits) > self.MAX_KEYS:
            self._sweep(now)
            if len(self._hits) > self.MAX_KEYS:
                self._evict_oldest()

    def _sweep(self, now: float) -> None:
        for key in [k for k, expires in self._expires.items() if expires <= now]:
            self._forget(key)
        self._last_sweep = now

    def _evict_oldest(self) -> None:
        """Only reached under a flood of LIVE keys: drop the ones closest to expiring, down
        to 90% of the ceiling, so the newest state — the attack in progress — is kept."""
        excess = len(self._hits) - int(self.MAX_KEYS * 0.9)
        for key, _ in sorted(self._expires.items(), key=lambda kv: kv[1])[:excess]:
            self._forget(key)

    def check(self, key: str, limit: Limit) -> tuple[bool, int]:
        """Check and consume in one step."""
        allowed, retry = self.peek(key, limit)
        if allowed:
            self.consume(key, limit)
        return allowed, retry

    def clear(self, key: str) -> None:
        self._forget(key)

    def reset(self) -> None:
        self._hits.clear()
        self._expires.clear()


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


def check_google(ip: str) -> tuple[bool, int]:
    """Read-only pre-check, like check_login."""
    return _windows.peek(f"google:ip:{ip}", GOOGLE_PER_IP)


def record_google_failure(ip: str) -> None:
    _windows.consume(f"google:ip:{ip}", GOOGLE_PER_IP)


def check_password_change(user_id: str) -> tuple[bool, int]:
    return _windows.peek(f"pwchange:{user_id}", PASSWORD_CHANGE_PER_USER)


def record_password_change_failure(user_id: str) -> None:
    _windows.consume(f"pwchange:{user_id}", PASSWORD_CHANGE_PER_USER)


def clear_password_change(user_id: str) -> None:
    _windows.clear(f"pwchange:{user_id}")


def check_mfa(user_id: str, ip: str) -> tuple[bool, int]:
    ok_user, retry_user = _windows.peek(f"mfa:user:{user_id}", MFA_FAILURES_PER_USER)
    ok_ip, retry_ip = _windows.peek(f"mfa:ip:{ip}", MFA_FAILURES_PER_IP)
    if not ok_user or not ok_ip:
        return False, max(retry_user, retry_ip)
    return True, 0


def record_mfa_failure(user_id: str, ip: str) -> None:
    _windows.consume(f"mfa:user:{user_id}", MFA_FAILURES_PER_USER)
    _windows.consume(f"mfa:ip:{ip}", MFA_FAILURES_PER_IP)


def clear_mfa(user_id: str) -> None:
    _windows.clear(f"mfa:user:{user_id}")


def check_otp_request(ip: str, phone: str) -> tuple[bool, int]:
    """Charge one code request against every budget, or none.

    All buckets are looked at first and only charged if every one has room, so a
    request refused by the cooldown does not also burn the daily allowance, and a
    client hammering a refused endpoint cannot extend its own lockout.
    """
    buckets = [
        (f"otp:cool:{phone}", OTP_RESEND_COOLDOWN),
        (f"otp:phone:{phone}", OTP_REQUEST_PER_PHONE),
        (f"otp:day:{phone}", OTP_REQUEST_PER_PHONE_DAY),
        (f"otp:ip:{ip}", OTP_REQUEST_PER_IP),
    ]
    verdicts = [(key, limit, *_windows.peek(key, limit)) for key, limit in buckets]
    refusals = [retry for _, _, ok, retry in verdicts if not ok]
    if refusals:
        return False, max(refusals)
    for key, limit, *_ in verdicts:
        _windows.consume(key, limit)
    return True, 0


def check_otp_verify(ip: str) -> tuple[bool, int]:
    return _windows.check(f"otp:verify:ip:{ip}", OTP_VERIFY_PER_IP)


def check_principal(user_id: str, heavy: bool = False) -> tuple[bool, int]:
    limit = HEAVY_PER_PRINCIPAL if heavy else API_PER_PRINCIPAL
    bucket = "heavy" if heavy else "api"
    return _windows.check(f"{bucket}:{user_id}", limit)


def reset() -> None:
    """Test hook."""
    _windows.reset()
