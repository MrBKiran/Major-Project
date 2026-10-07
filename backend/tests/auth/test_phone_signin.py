"""
Phase 5 — signing in with a phone number and a one-time code, for vehicle owners.

The flow: POST /api/auth/otp/request {phone} texts a six-digit code; POST
/api/auth/otp/verify {phone, code} exchanges it for a session.

What this has to get right, and where the tests below concentrate:

  * It must not be an oracle. Whether a number belongs to a customer is exactly the
    fact a stranger wants — so a request answers the same for a registered number
    and an unknown one, and a wrong code the same for both.
  * Six digits is a million possibilities. What protects the code is how few guesses
    it gets (five), how briefly it lives (five minutes), that it works once, and that
    only the newest code counts.
  * The customers table decides which number belongs to which owner — never a stale
    record. A number the dealer has since changed can no longer sign anyone in.
  * A code sent by SMS is only as strong as the phone number's owner, so a phone
    session is confined to roles that allow it (vehicle_owner alone) and cannot be
    switched into any other.
"""

from __future__ import annotations

import hmac
import json
import logging

import pytest
from sqlalchemy import text

from app.auth import ratelimit
from app.auth.audit import tail
from app.auth.phone import mask_phone, normalize_phone
from app.config import settings
from app.db.session import engine

from .helpers import (
    bearer, challenge_rows, claims_of, customers_of, expire_challenges, make_customer,
    make_user, new_phone,
)

REQUEST, VERIFY = "/api/auth/otp/request", "/api/auth/otp/verify"


def request_code(client, phone):
    return client.post(REQUEST, json={"phone": phone})


def verify_code(client, phone, code, **extra):
    return client.post(VERIFY, json={"phone": phone, "code": code, **extra})


def sign_in(client, sms, phone, **extra):
    """Request a code for `phone`, read it off the fake SMS, and verify it."""
    assert request_code(client, phone).status_code == 202
    code = sms.codes_for(normalize_phone(phone))[-1]
    return verify_code(client, phone, code, **extra)


def not_the(code: str) -> str:
    return "000000" if code != "000000" else "111111"


def _details(event) -> dict:
    d = event["detail"]
    return json.loads(d) if isinstance(d, str) else (d or {})


def linked_owner(name: str = "Asha Verma"):
    """(user, customer): an owner who already has an account, reachable by phone."""
    u = make_user()
    return u, make_customer(new_phone(), name=name, user_id=u["id"])


# ── on / off ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("provider,environment", [("none", "development"),
                                                  ("console", "production")])
def test_both_endpoints_do_not_exist_when_phone_sign_in_is_unavailable(client, monkeypatch,
                                                                       provider, environment):
    monkeypatch.setattr(settings, "sms_provider", provider)
    monkeypatch.setattr(settings, "environment", environment)
    assert request_code(client, "+919811820044").status_code == 404
    assert verify_code(client, "+919811820044", "123456").status_code == 404


# ── requesting a code ──────────────────────────────────────────────────────

def test_a_registered_number_is_texted_one_six_digit_code(client, sms):
    c = make_customer(new_phone())
    r = request_code(client, c["phone"])
    assert r.status_code == 202
    assert len(sms.sent) == 1
    assert sms.sent[0].to == c["e164"]                 # E.164, not the customer's spelling
    assert len(sms.codes_for(c["e164"])) == 1
    assert "Asha" not in sms.sent[0].body and c["name"] not in sms.sent[0].body


def test_the_response_is_identical_for_a_registered_and_an_unknown_number(client, sms):
    registered = request_code(client, make_customer(new_phone())["phone"])
    unknown = request_code(client, new_phone())
    assert (registered.status_code, registered.json()) == (unknown.status_code, unknown.json())
    assert registered.json() == {"status": "sent_if_registered", "expires_in": 300,
                                 "resend_after": 30}


def test_an_unknown_number_is_texted_nothing_but_still_leaves_a_challenge(client, sms):
    phone = new_phone()
    assert request_code(client, phone).status_code == 202
    assert sms.sent == []
    rows = challenge_rows(normalize_phone(phone))
    assert len(rows) == 1 and rows[0].eligible is False


@pytest.mark.parametrize("bad", ["", "abc", "12345", "+91 22 2345 6789", "9" * 40, None, 12345])
def test_a_value_that_is_not_a_mobile_number_is_a_422_and_texts_nothing(client, sms, bad):
    assert request_code(client, bad).status_code == 422
    assert sms.sent == []


def test_the_code_is_stored_as_a_keyed_hash_never_in_the_clear(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    code = sms.codes_for(c["e164"])[0]
    (row,) = challenge_rows(c["e164"])
    assert row.code_hmac != code and code not in row.code_hmac
    assert len(row.code_hmac) == 64 and set(row.code_hmac) <= set("0123456789abcdef")
    with engine.connect() as conn:                     # and there is nowhere else it could be kept
        columns = {r[0] for r in conn.execute(text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'otp_challenges'"))}
    assert columns == {"id", "phone_e164", "code_hmac", "created_at", "expires_at", "attempts",
                       "consumed_at", "eligible", "requested_ip"}


def test_a_stored_code_hash_is_bound_to_the_number():
    from app.auth.otp import code_mac

    assert code_mac("+919811820044", "123456") != code_mac("+919811820045", "123456")
    assert code_mac("+919811820044", "123456") == code_mac("+919811820044", "123456")


def test_codes_are_six_digits_and_keep_their_leading_zeros():
    from app.auth.otp import generate_code

    codes = [generate_code() for _ in range(300)]
    assert all(len(c) == 6 and c.isdigit() for c in codes)
    assert any(c.startswith("0") for c in codes), "leading zeros are being dropped"


def test_a_deactivated_owner_is_texted_nothing(client, sms):
    u, c = linked_owner()
    from .helpers import set_active

    set_active(u["id"], False)
    assert request_code(client, c["phone"]).status_code == 202       # same answer...
    assert sms.sent == []                                            # ...but no SMS


def test_an_owner_whose_account_cannot_use_phone_sign_in_is_texted_nothing(client, sms):
    staff = make_user(memberships=[("ORG-RAMAN", "fleet_manager")])
    c = make_customer(new_phone(), user_id=staff["id"])
    request_code(client, c["phone"])
    assert sms.sent == []


def test_a_provider_outage_does_not_change_the_answer_and_never_logs_the_code(
        client, sms, caplog):
    sms.fail = True
    c = make_customer(new_phone())
    with caplog.at_level(logging.DEBUG):
        r = request_code(client, c["phone"])
    assert r.status_code == 202
    assert any(rec.levelno >= logging.ERROR for rec in caplog.records), "the failure was swallowed"
    assert c["e164"] not in caplog.text                # masked in logs, like everywhere


def test_a_new_request_replaces_the_old_code(client, sms, no_otp_throttling):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    request_code(client, c["phone"])
    first, second = sms.codes_for(c["e164"])
    if first == second:
        pytest.skip("the two codes collided (1 in a million)")
    assert verify_code(client, c["phone"], first).status_code == 401
    assert verify_code(client, c["phone"], second).status_code == 200


# ── throttling what costs money ────────────────────────────────────────────

def test_a_resend_inside_the_cooldown_is_refused_with_a_retry_after(client, sms):
    c = make_customer(new_phone())
    assert request_code(client, c["phone"]).status_code == 202
    r = request_code(client, c["phone"])
    assert r.status_code == 429 and int(r.headers["Retry-After"]) > 0


def test_the_cooldown_applies_to_an_unknown_number_too(client, sms):
    # Otherwise "did I get throttled" would tell a stranger whether the number is real.
    phone = new_phone()
    assert request_code(client, phone).status_code == 202
    assert request_code(client, phone).status_code == 429


def _lift(monkeypatch, *names):
    for name in names:
        monkeypatch.setattr(ratelimit, name, ratelimit.Limit(max_calls=10**6, window_s=1))


def test_a_number_gets_at_most_three_codes_per_window(client, sms, monkeypatch):
    _lift(monkeypatch, "OTP_RESEND_COOLDOWN")
    c = make_customer(new_phone())
    assert [request_code(client, c["phone"]).status_code for _ in range(3)] == [202] * 3
    assert request_code(client, c["phone"]).status_code == 429
    assert len(sms.sent) == 3


def test_a_number_gets_at_most_ten_codes_a_day(client, sms, monkeypatch):
    _lift(monkeypatch, "OTP_RESEND_COOLDOWN", "OTP_REQUEST_PER_PHONE")
    c = make_customer(new_phone())
    assert [request_code(client, c["phone"]).status_code for _ in range(10)] == [202] * 10
    assert request_code(client, c["phone"]).status_code == 429


def test_one_address_cannot_ask_for_codes_for_unlimited_numbers(client, sms):
    codes = [request_code(client, new_phone()).status_code for _ in range(21)]
    assert codes[:20] == [202] * 20 and codes[20] == 429


def test_verification_attempts_are_limited_per_address(client, sms):
    phone = new_phone()
    results = [verify_code(client, phone, "123456").status_code for _ in range(31)]
    assert results[:30] == [401] * 30 and results[30] == 429


# ── verifying ──────────────────────────────────────────────────────────────

def test_the_right_code_signs_in_an_owner_who_already_has_an_account(client, sms):
    u, c = linked_owner()
    r = sign_in(client, sms, c["phone"])

    assert r.status_code == 200, r.text
    body = r.json()
    assert body["principal"]["user_id"] == u["id"]
    assert (body["principal"]["role"], body["principal"]["org"]["id"]) == \
        ("vehicle_owner", "ORG-CUSTOMERS")
    assert claims_of(body["access_token"])["amr"] == ["phone_otp"]
    assert client.get("/api/auth/me", headers=bearer(body["access_token"])).status_code == 200


def test_the_number_can_be_typed_however_the_owner_writes_it(client, sms):
    _, c = linked_owner()
    request_code(client, c["phone"])                              # "+91 98765 43210" style
    code = sms.codes_for(c["e164"])[-1]
    national = c["e164"][3:]                                      # "9876543210"
    assert verify_code(client, national, code).status_code == 200


def test_the_first_sign_in_records_the_phone_identity_and_stamps_it_used(client, sms):
    u, c = linked_owner()
    sign_in(client, sms, c["phone"])
    with engine.connect() as conn:
        row = conn.execute(text("SELECT user_id, last_used_at FROM user_identities "
                                "WHERE provider = 'phone' AND subject = :s"),
                           {"s": c["e164"]}).first()
    assert row.user_id == u["id"] and row.last_used_at is not None


def test_a_wrong_code_is_refused_the_same_way_as_an_unknown_number(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    wrong = verify_code(client, c["phone"], not_the(sms.codes_for(c["e164"])[0]))
    unknown = verify_code(client, new_phone(), "123456")
    assert (wrong.status_code, wrong.json()) == (unknown.status_code, unknown.json())
    assert wrong.status_code == 401


def test_five_wrong_guesses_kill_the_code_even_for_the_right_answer(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    real = sms.codes_for(c["e164"])[0]
    for _ in range(5):
        assert verify_code(client, c["phone"], not_the(real)).status_code == 401
    assert verify_code(client, c["phone"], real).status_code == 401
    assert challenge_rows(c["e164"])[0].attempts == 5


def test_a_code_works_once(client, sms):
    _, c = linked_owner()
    request_code(client, c["phone"])
    code = sms.codes_for(c["e164"])[0]
    assert verify_code(client, c["phone"], code).status_code == 200
    assert verify_code(client, c["phone"], code).status_code == 401
    assert challenge_rows(c["e164"])[0].consumed_at is not None


def test_an_expired_code_is_refused(client, sms):
    _, c = linked_owner()
    request_code(client, c["phone"])
    code = sms.codes_for(c["e164"])[0]
    expire_challenges(c["e164"])
    assert verify_code(client, c["phone"], code).status_code == 401


def test_a_code_for_one_number_does_not_work_for_another(client, sms, no_otp_throttling):
    (_, a), (_, b) = linked_owner(), linked_owner()
    request_code(client, a["phone"])
    request_code(client, b["phone"])
    code_a, code_b = sms.codes_for(a["e164"])[0], sms.codes_for(b["e164"])[0]
    if code_a == code_b:
        pytest.skip("the two codes collided (1 in a million)")
    assert verify_code(client, b["phone"], code_a).status_code == 401


def test_verifying_without_ever_requesting_is_refused(client, sms):
    _, c = linked_owner()
    assert verify_code(client, c["phone"], "123456").status_code == 401


def test_a_challenge_recorded_before_the_number_was_registered_can_never_verify(client, sms):
    # Nothing was texted for it, so nobody should hold its code — but if one were
    # somehow known, a row written for a number that was not allowed to sign in must
    # not start working just because the number became a customer's later.
    from app.auth.otp import code_mac

    phone = new_phone()
    e164 = normalize_phone(phone)
    request_code(client, phone)                       # unknown at the time: ineligible row
    make_customer(phone)                              # ...and the number becomes real afterwards
    with engine.begin() as conn:
        conn.execute(text("UPDATE otp_challenges SET code_hmac = :h WHERE phone_e164 = :p"),
                     {"h": code_mac(e164, "424242"), "p": e164})
    assert verify_code(client, phone, "424242").status_code == 401


@pytest.mark.parametrize("bad", ["12345", "1234567", "abcdef", "12 456", "", "１２３４５６"])
def test_a_code_that_is_not_six_ascii_digits_is_a_422(client, sms, bad):
    assert verify_code(client, new_phone(), bad).status_code == 422


def test_the_code_is_compared_in_constant_time(client, sms, monkeypatch):
    _, c = linked_owner()
    request_code(client, c["phone"])
    code = sms.codes_for(c["e164"])[0]
    calls = []
    real = hmac.compare_digest
    monkeypatch.setattr(hmac, "compare_digest", lambda a, b: calls.append(1) or real(a, b))
    verify_code(client, c["phone"], code)
    assert calls, "the code was compared with something other than hmac.compare_digest"


def test_a_deactivated_owner_is_refused_at_verification_too(client, sms):
    from .helpers import set_active

    u, c = linked_owner()
    request_code(client, c["phone"])
    code = sms.codes_for(c["e164"])[0]
    set_active(u["id"], False)                        # deactivated AFTER the code went out
    assert verify_code(client, c["phone"], code).status_code == 403


# ── the customers table is the truth about whose number it is ──────────────

def test_a_number_the_dealer_has_since_changed_can_no_longer_sign_in(
        client, sms, no_otp_throttling):
    from app.db.models import Customer
    from app.db.session import SessionLocal

    u, c = linked_owner()
    assert sign_in(client, sms, c["phone"]).status_code == 200      # binds the identity

    new_number = new_phone()
    with SessionLocal() as s:
        s.get(Customer, c["id"]).phone = new_number
        s.commit()

    sms.sent.clear()
    request_code(client, c["phone"])                                # the OLD number
    assert sms.sent == []
    assert verify_code(client, c["phone"], "123456").status_code == 401

    r = sign_in(client, sms, new_number)                            # the new one works
    assert r.status_code == 200 and r.json()["principal"]["user_id"] == u["id"]


def test_two_owners_sharing_a_number_linked_to_different_accounts_is_never_guessed(client, sms):
    shared = new_phone()
    a, b = make_user(), make_user()
    make_customer(shared, user_id=a["id"])
    make_customer(shared, user_id=b["id"])
    request_code(client, shared)
    assert sms.sent == []                             # ambiguous: an administrator decides


def test_a_number_already_bound_to_another_account_is_a_conflict_not_a_takeover(client, sms):
    from app.auth.identities import link_identity

    holder, claimant = make_user(), make_user()
    c = make_customer(new_phone(), user_id=claimant["id"])
    with engine.begin() as conn:
        link_identity(conn, holder["id"], "phone", c["e164"])
    request_code(client, c["phone"])
    assert sms.sent == []


# ── a phone session is confined ────────────────────────────────────────────

def test_a_phone_session_only_ever_holds_an_owner_role_even_for_a_multi_role_user(client, sms):
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    c = make_customer(new_phone(), user_id=u["id"])
    r = sign_in(client, sms, c["phone"])
    assert r.status_code == 200
    assert r.json()["principal"]["role"] == "vehicle_owner"      # not offered a choice


def test_a_phone_session_cannot_be_switched_into_a_staff_role(client, sms):
    # SIM-swap an owner's number and walk into their fleet-manager account: this is
    # the door that has to stay shut.
    u = make_user(memberships=[("ORG-CUSTOMERS", "vehicle_owner"), ("ORG-RAMAN", "fleet_manager")])
    c = make_customer(new_phone(), user_id=u["id"])
    tok = sign_in(client, sms, c["phone"]).json()["access_token"]
    r = client.post("/api/auth/switch", json={"org_id": "ORG-RAMAN", "role": "fleet_manager"},
                    headers=bearer(tok))
    assert r.status_code == 403
    listed = client.get("/api/auth/memberships", headers=bearer(tok)).json()["memberships"]
    assert {m["role"] for m in listed} == {"vehicle_owner"}


def test_the_session_method_check_holds_even_if_the_earlier_checks_were_bypassed(client, sms):
    # Craft a valid, eligible challenge for an account with no owner role at all.
    from app.auth.otp import code_mac

    staff = make_user(memberships=[("ORG-RAMAN", "fleet_manager")])
    c = make_customer(new_phone(), user_id=staff["id"])
    with engine.begin() as conn:
        conn.execute(text(
            "INSERT INTO otp_challenges (phone_e164, code_hmac, created_at, expires_at, "
            "attempts, eligible) VALUES (:p, :h, now(), now() + interval '5 minutes', 0, true)"),
            {"p": c["e164"], "h": code_mac(c["e164"], "424242")})
    r = verify_code(client, c["phone"], "424242")
    assert r.status_code in (401, 403)
    assert "access_token" not in r.json()


# ── creating the account on first sign-in ──────────────────────────────────

def test_an_owner_with_no_account_gets_one_on_first_sign_in(client, sms):
    c = make_customer(new_phone(), name="Meera Kapoor")
    r = sign_in(client, sms, c["phone"])
    assert r.status_code == 200, r.text

    principal = r.json()["principal"]
    assert principal["email"] == f"p{c['e164'][1:]}@phone.autosaarthi.invalid"
    assert (principal["full_name"], principal["role"]) == ("Meera Kapoor", "vehicle_owner")
    assert customers_of(principal["user_id"]) == [c["id"]]
    with engine.connect() as conn:
        user = conn.execute(text("SELECT password_hash, is_active FROM users WHERE id = :u"),
                            {"u": principal["user_id"]}).first()
        identity = conn.execute(text("SELECT subject FROM user_identities WHERE user_id = :u"),
                                {"u": principal["user_id"]}).scalar()
    assert user.is_active and identity == c["e164"]


def test_the_created_account_cannot_be_entered_with_a_password(client, sms):
    c = make_customer(new_phone())
    email = sign_in(client, sms, c["phone"]).json()["principal"]["email"]
    from .helpers import login

    # 401 (wrong credentials) or 422 (the reserved .invalid domain is not an
    # acceptable address at all): either way, no session.
    assert login(client, email, "autosaarthi").status_code in (401, 422)
    assert login(client, email, "").status_code in (401, 422)


def test_a_second_sign_in_reuses_the_account(client, sms, no_otp_throttling):
    c = make_customer(new_phone())
    first = sign_in(client, sms, c["phone"]).json()["principal"]["user_id"]
    second = sign_in(client, sms, c["phone"]).json()["principal"]["user_id"]
    assert first == second
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users WHERE email LIKE :e"),
                            {"e": f"p{c['e164'][1:]}@%"}).scalar() == 1


def test_customers_sharing_one_number_and_no_account_share_one_new_account(client, sms):
    phone = new_phone()
    a, b = make_customer(phone, name="Household A"), make_customer(phone, name="Household B")
    uid = sign_in(client, sms, phone).json()["principal"]["user_id"]
    assert sorted(customers_of(uid)) == sorted([a["id"], b["id"]])


def test_a_customer_sharing_the_number_of_a_linked_one_joins_that_account(client, sms):
    phone = new_phone()
    u = make_user()
    make_customer(phone, user_id=u["id"])
    extra = make_customer(phone)
    assert sign_in(client, sms, phone).json()["principal"]["user_id"] == u["id"]
    assert extra["id"] in customers_of(u["id"])


def test_a_failed_verification_creates_nothing(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    verify_code(client, c["phone"], not_the(sms.codes_for(c["e164"])[0]))
    with engine.connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM users WHERE email LIKE :e"),
                            {"e": f"p{c['e164'][1:]}@%"}).scalar() == 0
        assert conn.execute(text("SELECT count(*) FROM user_identities WHERE subject = :s"),
                            {"s": c["e164"]}).scalar() == 0


# ── the audit trail and the logs ───────────────────────────────────────────

def test_a_request_is_audited_with_the_masked_number_only(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    masked = mask_phone(c["e164"])
    lines = [e for e in tail(limit=30, subject=masked) if e["action"] == "auth.otp_requested"]
    assert lines, "the request was not audited"
    with engine.connect() as conn:
        digits = c["e164"][1:]
        leaked = conn.execute(text(
            "SELECT count(*) FROM access_audit WHERE subject LIKE :d OR detail::text LIKE :d"),
            {"d": f"%{digits}%"}).scalar()
    assert leaked == 0, "the full number reached the audit log"


def test_a_sign_in_is_audited_with_its_method(client, sms):
    u, c = linked_owner()
    sign_in(client, sms, c["phone"])
    line = next(e for e in tail(limit=30, subject=u["email"]) if e["action"] == "auth.login")
    assert _details(line)["method"] == "phone_otp"


def test_a_refusal_is_audited_with_a_reason_and_never_the_code(client, sms):
    c = make_customer(new_phone())
    request_code(client, c["phone"])
    real = sms.codes_for(c["e164"])[0]
    verify_code(client, c["phone"], not_the(real))
    lines = [e for e in tail(limit=30, subject=mask_phone(c["e164"]))
             if e["action"] == "auth.login_failed"]
    assert lines and _details(lines[0])["reason"] == "wrong_code"
    assert real not in json.dumps([str(e) for e in lines])


def test_the_endpoints_never_log_the_code(client, sms, caplog):
    _, c = linked_owner()
    with caplog.at_level(logging.DEBUG):
        request_code(client, c["phone"])
        code = sms.codes_for(c["e164"])[0]
        verify_code(client, c["phone"], code)
    assert code not in caplog.text
