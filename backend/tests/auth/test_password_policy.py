"""
Phase 6 — what makes a new password acceptable.

Follows current NIST guidance (SP 800-63B): a sensible minimum length, no forced mix
of character classes, and screening against what people actually choose — the common
passwords, anything built from the person's own address or the product's name, and
strings that are just a run on the keyboard. Long passphrases are welcome.
"""

from __future__ import annotations

import pytest

from .helpers import pbkdf2_hash

EMAIL = "meera.kapoor@example.com"


def reasons(password: str, **kw) -> list[str]:
    from app.auth.password_policy import check_new_password

    return check_new_password(password, email=kw.pop("email", EMAIL), **kw)


@pytest.mark.parametrize("good", [
    "correct horse battery staple",           # a passphrase: length, not symbols
    "tr4ffic-Light-9-lantern",
    "purple giraffes eat 42 lemons",
    "Xk9#mQ2$vL8@",
    "lowercase only but quite long enough",     # no character-class rules
])
def test_reasonable_passwords_are_accepted(good):
    assert reasons(good) == []


def test_the_minimum_is_ten_characters():
    assert reasons("Xk9#mQ2$v")            # 9 characters
    assert reasons("Xk9#mQ2$vL") == []      # 10


@pytest.mark.parametrize("common", [
    "password", "Password123", "password123!", "qwertyuiop", "letmein123", "iloveyou1",
    "administrator", "welcome123", "abc123456789", "Passw0rd!!",
])
def test_common_passwords_are_refused_even_when_decorated(common):
    found = reasons(common)
    assert any("common" in r for r in found), f"{common!r} -> {found}"


@pytest.mark.parametrize("password", [
    "meera.kapoor-2024!", "MEERAKAPOOR1234", "xx-meera.kapoor-xx",
    "autosaarthi2024!", "AutoSaarthi#Fleet", "my-autosaarthi-pw",
])
def test_the_persons_own_address_and_the_product_name_are_refused(password):
    assert any("email" in r or "product" in r for r in reasons(password)), password


@pytest.mark.parametrize("password", [
    "aaaaaaaaaaaa", "1111111111", "0123456789", "abcdefghijkl", "zyxwvutsrqpo",
    "qwertyuiopas", "9876543210", "ababababab",
])
def test_repeated_and_sequential_strings_are_refused(password):
    assert any("predictable" in r for r in reasons(password)), password


def test_the_new_password_must_differ_from_the_current_one():
    current = pbkdf2_hash("Existing-passphrase-77", 1_000)
    assert any("different" in r for r in reasons("Existing-passphrase-77", current_hash=current))
    assert reasons("Another-passphrase-88", current_hash=current) == []


def test_several_problems_are_all_reported_together():
    found = reasons("password")
    assert len(found) >= 2                     # too short AND too common


def test_a_very_long_passphrase_is_fine():
    assert reasons("this is a long sentence that nobody would guess " * 3) == []


def test_the_person_is_not_told_which_word_matched_only_that_something_did():
    # The message names the rule, not the secret it compared against.
    assert all("kapoor" not in r for r in reasons("meera.kapoor-2024!"))
