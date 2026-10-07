"""
Phone numbers, in one canonical form.

The same number is written a dozen ways ("+91 98118 20044", "09811820044",
"(+91) 98118-20044"). Everything that stores, looks up or rate-limits a number
does so on its E.164 form ("+919811820044") and nothing else — otherwise one
person is several, or two spellings of different numbers collide.

Only numbers that can receive an SMS are accepted: a landline normalises to
None, as does anything with letters (the library would otherwise turn a vanity
number like "1-800-FLOWERS" into digits) or an extension.
"""

from __future__ import annotations

import re

import phonenumbers
from phonenumbers import NumberParseException, PhoneNumberFormat, PhoneNumberType

# The customers table holds Indian owners, so a bare national number is read as one.
DEFAULT_REGION = "IN"

_CAN_RECEIVE_SMS = {PhoneNumberType.MOBILE, PhoneNumberType.FIXED_LINE_OR_MOBILE}
_ALLOWED_CHARS = re.compile(r"^[0-9+\-\s().]+$")
_MAX_INPUT_CHARS = 32


def normalize_phone(raw: object) -> str | None:
    """The E.164 form of `raw`, or None if it is not a number that can get an SMS."""
    if not isinstance(raw, str):
        return None
    raw = raw.strip()
    if not raw or len(raw) > _MAX_INPUT_CHARS or not _ALLOWED_CHARS.match(raw):
        return None
    try:
        parsed = phonenumbers.parse(raw, DEFAULT_REGION)
    except NumberParseException:
        return None
    if parsed.extension or not phonenumbers.is_valid_number(parsed):
        return None
    if phonenumbers.number_type(parsed) not in _CAN_RECEIVE_SMS:
        return None
    return phonenumbers.format_number(parsed, PhoneNumberFormat.E164)


def mask_phone(e164: str) -> str:
    """'+919811820044' -> '+91*******044', for logs and screens. Keeps the ends only."""
    if not isinstance(e164, str):
        return ""
    if len(e164) <= 6:
        return e164
    return e164[:3] + "*" * (len(e164) - 6) + e164[-3:]
