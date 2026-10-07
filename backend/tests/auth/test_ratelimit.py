"""
The limiter's own behaviour — above all, that it cannot be used to exhaust memory.

Found in review: `peek()` went through a defaultdict, so merely CHECKING a limit created an
entry for the key. Login checks its budget before verifying anything, with a key made from
whatever email the caller typed — so an unauthenticated client could grow the table by one
entry per request, including requests it was about to be refused for, until the process ran
out of memory. The rules now: checking never creates state, state exists only while a window
is live, expired state is swept, and the whole table has a hard ceiling.
"""

from __future__ import annotations

import pytest

from app.auth import ratelimit
from app.auth.ratelimit import Limit, _Windows


class Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


@pytest.fixture
def clock():
    return Clock()


@pytest.fixture
def windows(clock):
    return _Windows(clock=clock)


LIMIT = Limit(max_calls=3, window_s=10)


# ── it still limits ────────────────────────────────────────────────────────

def test_it_allows_up_to_the_limit_then_refuses_with_a_retry_after(windows, clock):
    assert [windows.check("k", LIMIT)[0] for _ in range(3)] == [True, True, True]
    allowed, retry = windows.check("k", LIMIT)
    assert allowed is False and 1 <= retry <= 11


def test_the_window_slides(windows, clock):
    for _ in range(3):
        windows.consume("k", LIMIT)
    assert windows.peek("k", LIMIT)[0] is False
    clock.advance(11)
    assert windows.peek("k", LIMIT)[0] is True


def test_keys_do_not_share_a_budget(windows):
    for _ in range(3):
        windows.consume("a", LIMIT)
    assert windows.peek("a", LIMIT)[0] is False and windows.peek("b", LIMIT)[0] is True


def test_clearing_a_key_forgets_it(windows):
    for _ in range(3):
        windows.consume("k", LIMIT)
    windows.clear("k")
    assert windows.peek("k", LIMIT)[0] is True and windows.size() == 0


# ── it cannot be used to exhaust memory ────────────────────────────────────

def test_checking_a_limit_never_creates_state(windows):
    for i in range(1000):
        windows.peek(f"login:acct:{i}@example.com", LIMIT)
    assert windows.size() == 0


def test_state_disappears_once_its_window_has_passed(windows, clock):
    windows.consume("k", LIMIT)
    assert windows.size() == 1
    clock.advance(11)
    windows.peek("k", LIMIT)                      # asked about again after the window
    assert windows.size() == 0


def test_expired_state_is_swept_even_if_nobody_asks_about_it_again(windows, clock):
    for i in range(500):
        windows.consume(f"k{i}", LIMIT)
    assert windows.size() == 500
    clock.advance(_Windows.SWEEP_EVERY_S + 1)     # far beyond every window
    windows.consume("fresh", LIMIT)               # any later activity triggers the sweep
    assert windows.size() == 1


def test_the_table_has_a_hard_ceiling_under_a_flood(windows):
    windows.MAX_KEYS = 100
    for i in range(5000):
        windows.consume(f"k{i}", Limit(1, 3600))  # all live: nothing is expirable
    assert windows.size() <= 100


def test_a_flood_cannot_evict_the_most_recent_keys(windows, clock):
    windows.MAX_KEYS = 100
    for i in range(1000):
        clock.advance(0.001)
        windows.consume(f"k{i}", Limit(1, 3600))
    assert windows.peek("k999", Limit(1, 3600))[0] is False     # newest is still counted


# ── the real entry points ──────────────────────────────────────────────────

def test_a_flood_of_refused_logins_from_one_address_adds_no_state():
    # The attack: the IP budget is spent, and the attacker keeps sending fresh emails.
    # Each request is refused — and must cost the server no memory.
    ip = "203.0.113.9"
    for i in range(ratelimit.LOGIN_PER_IP.max_calls):
        ratelimit.record_login_failure(ip, f"seed{i}@example.com")
    baseline = ratelimit._windows.size()

    for i in range(2000):
        allowed, _ = ratelimit.check_login(ip, f"flood{i}@example.com")
        assert allowed is False
    assert ratelimit._windows.size() == baseline


def test_refused_code_requests_add_no_state():
    ip = "203.0.113.10"
    for i in range(ratelimit.OTP_REQUEST_PER_IP.max_calls):
        assert ratelimit.check_otp_request(ip, f"+9198765{i:05d}")[0]
    baseline = ratelimit._windows.size()

    for i in range(2000):
        assert ratelimit.check_otp_request(ip, f"+9199999{i:05d}")[0] is False
    assert ratelimit._windows.size() == baseline
