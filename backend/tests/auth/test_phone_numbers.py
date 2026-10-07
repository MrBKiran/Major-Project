"""
Phase 3 — phone numbers, normalised.

The same number is written a dozen ways ("+91 98118 20044", "09811820044",
"(+91) 98118-20044"), and a sign-in that compares raw strings would treat one
person as several — or, worse, let two spellings of different numbers collide.
Everything that stores, looks up or rate-limits a number does so on the E.164 form
this module produces, and nothing else.
"""

from __future__ import annotations

import pytest

from app.auth.phone import mask_phone, normalize_phone


@pytest.mark.parametrize("raw,expected", [
    ("+91 98118 20044", "+919811820044"),      # how the customers table stores them
    ("9811820044", "+919811820044"),           # bare national number: India is assumed
    ("09811820044", "+919811820044"),          # trunk prefix
    ("+91-98118-20044", "+919811820044"),
    ("(+91) 98118 20044", "+919811820044"),
    ("  +919811820044  ", "+919811820044"),
    ("+1 415 555 2671", "+14155552671"),       # other countries are valid E.164 too
    ("+44 7911 123456", "+447911123456"),
])
def test_mobile_numbers_are_normalised_to_e164(raw, expected):
    assert normalize_phone(raw) == expected


@pytest.mark.parametrize("raw", [
    None, "", "   ", "12345", "abcdefghij", "not a number",
    "+91 22 2345 6789",           # a Mumbai landline cannot receive an SMS
    "+91 12345 67890",            # Indian mobiles start 6-9
    "0000000000", "+999 1234567", "9" * 30,
    "+91 98118 20044 ext 5",
], ids=lambda v: repr(v)[:24])
def test_anything_that_cannot_receive_an_sms_normalises_to_none(raw):
    assert normalize_phone(raw) is None


def test_two_spellings_of_one_number_normalise_identically():
    assert normalize_phone("+91 98118 20044") == normalize_phone("09811820044")


def test_a_non_string_is_not_a_phone_number():
    assert normalize_phone(9811820044) is None       # type: ignore[arg-type]


def test_masking_keeps_only_the_ends():
    masked = mask_phone("+919811820044")
    assert masked == "+91*******044"
    assert "98118" not in masked


def test_masking_a_short_or_missing_value_does_not_raise():
    assert mask_phone("") == ""
    assert mask_phone("+1") == "+1"
