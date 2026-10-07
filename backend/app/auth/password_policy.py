"""
What makes a new password acceptable.

Follows NIST SP 800-63B rather than the older composition rules: a sensible minimum
length, NO forced mix of upper/lower/digit/symbol (it produces "Password1!" and
nothing stronger), and screening against what people actually pick — the well-known
passwords, anything built from the person's own address or the product's name, and
strings that are just a run on the keyboard. A long passphrase is welcome.

Returns every problem at once, so the person fixes them in one go instead of one
rejection at a time. The messages name the rule, never the value it was compared with.
"""

from __future__ import annotations

import re

from app.auth.principal import verify_password

MIN_LENGTH = 10
PRODUCT_WORDS = ("autosaarthi",)

# Not a breach corpus — a floor. The passwords everyone tries first. Matched after
# lower-casing, undoing common letter-for-digit swaps, and dropping trailing digits
# and symbols, so "Password123!" and "P@ssw0rd" are caught as "password".
_COMMON = frozenset("""
password passw0rd letmein welcome admin administrator login master monkey dragon
qwerty qwertyuiop qwertyuiopasdfghjkl asdfghjkl zxcvbnm iloveyou trustno1 sunshine
princess football baseball superman batman shadow michael jennifer hunter freedom
whatever starwars hello hello123 secret changeme changeit default guest test testing
abc123 abcd1234 abc123456789 111111 123456 1234567 12345678 123456789 1234567890
000000 password1 welcome1 letmein1 iloveyou1 qazwsx qazwsxedc 1q2w3e4r 1q2w3e
zaq12wsx trustme mustang access flower cheese killer soccer harley ranger
jordan tigger pepper thomas hockey ginger joshua bailey matrix computer internet
""".split())

_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t",
                       "@": "a", "$": "s"})

_RUNS = tuple(seq for base in ("abcdefghijklmnopqrstuvwxyz", "0123456789",
                               "qwertyuiopasdfghjklzxcvbnm")
              for seq in (base, base[::-1]))


def _alnum(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _is_common(password: str) -> bool:
    lowered = password.lower()
    candidates = {_alnum(lowered), _alnum(lowered.translate(_LEET))}
    for c in list(candidates):
        candidates.add(c.rstrip("0123456789"))
        # A known password followed by nothing but digits ("abc123" + "456789").
        for known in _COMMON:
            if len(known) >= 6 and c.startswith(known) and c[len(known):].isdigit():
                return True
    return any(c in _COMMON for c in candidates if len(c) >= 4)


def _contains_identity(password: str, email: str) -> bool:
    plain = _alnum(password)
    local = _alnum(email.split("@")[0])
    if len(local) >= 4 and local in plain:
        return True
    return any(word in plain for word in PRODUCT_WORDS)


def _is_predictable(password: str) -> bool:
    plain = _alnum(password)
    if len(set(password)) <= 3:                 # "aaaaaaaaaaaa", "ababababab"
        return True
    return len(plain) >= 8 and any(plain in run for run in _RUNS)


def check_new_password(password: str, *, email: str, current_hash: str | None = None) -> list[str]:
    """Every reason `password` is not acceptable; empty means it is."""
    problems: list[str] = []
    if len(password) < MIN_LENGTH:
        problems.append(f"must be at least {MIN_LENGTH} characters long")
    if _is_common(password):
        problems.append("is one of the most commonly used passwords")
    if _contains_identity(password, email):
        problems.append("must not contain your email address or the product name")
    if _is_predictable(password):
        problems.append("is too predictable (repeated or sequential characters)")
    if current_hash is not None and verify_password(password, current_hash):
        problems.append("must be different from your current password")
    return problems
