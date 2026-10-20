# Authentication — TDD evidence report

What was built, how each behaviour was proved, and what was found when the result was reviewed.
Every command and outcome below was actually run; where something was *not* done, it says so.

- **Source.** No `*.plan.md`; the plan was agreed in conversation: real authentication for the
  existing FastAPI backend — Google, phone number + code, TOTP MFA as the "etc." — plus fewer roles.
  User journeys were derived during the run.
- **Runner.** `python -m pytest tests -q` in `backend/` (pytest 8.3.4, Python 3.11, project `.venv`).
  Coverage: `--cov=app.auth …` (pytest-cov 7.1.0). Lint: `ruff check --select E,F,W,I,B`.
- **Result (through Phase 6b / the security review).** 586 tests pass (26 files); **95%** statement
  coverage on the auth code (1770 statements, 87 missed); ruff clean. `app/auth/scope.py` (74%) is
  unchanged row-scoping code covered by the live-server tenancy suite, which is not measured
  in-process. **After Phase 7** (below): 600 tests, 96%.
- **No checkpoint commits.** The project is not a git repository, so the "commit after RED / GREEN"
  step could not apply; this report is the record instead.

## User journeys

| # | As a… | I want to… | so that… |
|---|---|---|---|
| 1 | platform admin | be unable to mint a token for a deployment that forgot `JWT_SECRET` | the published dev key is not a skeleton key |
| 2 | vehicle owner | sign in with my phone number and a texted code | I need no password for the app on my phone |
| 3 | fleet manager / analyst | sign in with my Google account | I use the identity I already have — if an admin provisioned me |
| 4 | quality manager | be asked for an authenticator code | a stolen password is not enough to send a recall to a plant |
| 5 | security analyst | watch the live event stream only if I am entitled to | the stream is not open to whoever connects |
| 6 | operator | create accounts, reset a lost authenticator, switch someone off | there is a real way to run this without editing the database |
| 7 | anyone | change my own password | credentials can be rotated |
| 8 | product owner | keep only the roles that have a screen | the role set means something |

## Phases: RED → GREEN

| Phase | Behaviour | Tests | RED (before any production code) | GREEN |
|---|---|---|---|---|
| 0 Harness | Isolated, seeded `autosaarthi_test` DB; in-process app so fakes can be injected | `test_harness.py` (6) | `fixture 'client' not found` | 6 passed |
| 1 Roles 10 → 8 | Retire `oem_analyst`, `service_technician`; reversible data migration; fail closed on undefined / mis-kinded roles | `test_roles.py` (25) | 16 failed, 9 passed — incl. a platform_admin membership in a *customer* org logging in | 25 passed; suite 71 |
| 2 Close the holes | Fail-closed signing key; login timing oracle; PBKDF2 600k + rehash; per-user seed hashes; `iss`/`aud`/required claims; thin public health; authenticated WebSocket | `test_tokens` `test_passwords` `test_health` `test_ws_events` (99 in the first cut) | 48 failed / 25 passed, then 26 failed (WS). e.g. `a token signed with the published dev key was accepted` (`200 == 401`); `expected the same work as a real check, saw []`; 22× `DID NOT RAISE WebSocketDisconnect` (unauthenticated clients were streamed events) | 99 passed; suite 170 |
| 3 Identity core | Per-role `login_methods` / `mfa_required`; `user_identities`; E.164 phones; one `issue_session()` funnel; `amr`; `/api/auth/config` | `test_login_methods` `test_sessions` `test_phone_numbers` `test_identities` `test_config_endpoint` | 47 failed, 7 passed, 4 errors (the 7 passes are characterisation tests pinning behaviour the refactor had to preserve) | 86 passed; suite 257 |
| 4 Google | Verified ID token; bound to `sub`; provisioned users only; email link once | `test_google_signin` (22) `test_google_verifier` (26) | 3 failed, 1 passed, 41 errors (`ModuleNotFoundError: app.auth.google`) | 44 passed → 1 real gap found (email case) → fixed; suite 302 |
| 5 Phone code | Six-digit HMAC-stored code, 5 guesses, 5 minutes, single use, uniform answers, throttled, owners only, SMS senders | `test_phone_signin` (59) `test_sms_senders` (21) | 23 failed, 2 passed, 55 errors (`ModuleNotFoundError: app.auth.sms` / `otp`) | 80 passed |
| 6a Passwords | NIST-style policy; change-password ends other sessions | `test_password_policy` (34) `test_password_change` (16) | 50 failed | 50 passed |
| 6b MFA | TOTP enrol/confirm/verify; replay protection; recovery codes; encrypted secret; enforcement with enrolment-only session; admin reset | `test_mfa` (49) `test_mfa_enforcement` (39) | 27 failed, 35 passed, 55 errors (`No module named 'app.auth.mfa'`, `KeyError: 'scp'`, `'next_step'`) | 81 passed; suite 514 |
| — Lifecycle & provisioning | Logout / admin revoke / access log; `manage` CLI | `test_session_lifecycle` (11) `test_manage` (29) | 26 failed (`No module named 'app.auth.manage'`) | 553 passed after the 403 change below |
| 7 Refresh tokens | 15-minute access token; rotating httpOnly refresh cookie; reuse revokes the whole family + `token_version`; revoked everywhere a session already is; no cookie for `mfa_enroll` | `test_refresh` (14) | `ImportError: cannot import name 'refresh' from 'app.auth'` (collection failure — nothing existed yet) | 14 passed; suite 600 |

### Phase 7 in detail

Built after the security review, on top of the already-shipped six phases, continuing the same
funnel: `mint_session()` (`app/auth/sessions.py`) now takes the `Response` and, for a `scp: full`
session only, mints a refresh token (`app/auth/refresh.py`) and sets it as an httpOnly cookie —
one call site, same as every other session rule in this codebase. `POST /api/auth/refresh` is the
only new route; every existing `token_version`-bumping call site gained one line
(`refresh.revoke_all_for_user`): `/logout`, admin `/revoke-sessions`, `/password/change`, admin
`/users/{id}/reset-mfa`, and `manage.py`'s `deactivate`/`set-password`/`reset-mfa`.

Migration `ade11682b8b1` (new `refresh_tokens` table) was autogenerated against the live dev
database and applied (`alembic upgrade head`); the in-process test database picks it up for free
through `Base.metadata.create_all()`, which is how every other table in this suite gets there.

**Follow-up fix (found in live use, 2026-10-13/20).** A page reload during a refresh sent the same
cookie twice in one second; reuse detection read that as theft and signed the user out everywhere.
Fixed test-first: a reuse within `REUSE_GRACE_S` (20 s) of rotation answers `409` and burns
nothing, and the client retries once. RED: 3 failed (`assert 401 == 409`, session burned). While
testing it, a second defect: every refusal *raised* `HTTPException`, which builds a fresh response
and dropped the cookie deletion, so a dead cookie was never cleared. Refusals are now *returned*
with the cookie cleared (RED: `test_a_dead_refresh_cookie_is_cleared`). Mutations: no grace window
→ 3 caught; refusal keeps the cookie → caught. Client: `refreshSession` retries a 409 once (5 Vitest
tests, 2 RED first). Verified live: two simultaneous refreshes → `[200, 409]`, retry `200`, `/me`
still `200`. `test_refresh` 18 tests; full suite 616.

A process note worth keeping, same shape as the "test that did not reproduce its bug" entry below:
the first version of `test_logout_revokes_the_refresh_token_too` read the refresh cookie back from
the TestClient's cookie jar *after* calling `/logout` — but `/logout` calls `delete_cookie()`,
which clears that jar entry client-side regardless of whether the token was actually revoked
server-side, so the test would have passed even with the revocation line removed (confirmed: it
did, when deliberately removed). Fixed to capture the cookie from the *login* response instead,
and explicitly re-present that captured value after logout — simulating an attacker who kept a
copy — at which point removing the revocation line correctly turned it red.

### Process notes worth keeping

* **Inert scaffolding before RED.** Settings fields (`environment`, `ws_auth_timeout_s`,
  `google_client_id`, …) were added before the first run so tests fail on *behaviour*, not on a
  missing knob. They change nothing by themselves.
* **A false GREEN, caught.** A test helper used `password_hash or default`, so an *empty* hash was
  silently replaced and the "unusable hash" case passed for the wrong reason. Found because one of
  three parametrised cases did not fail in RED; the helper was fixed and all three went RED.
* **A test that did not reproduce its bug, caught.** The first version of the switch-vs-revocation
  race test *passed* in RED, because it revoked after the code's own read. Re-aimed at the real
  window (between authentication and the route body) it failed with `a revoked session was
  resurrected by a racing switch` — the actual bug.
* **A design flaw found by wiring the UI.** Wrong *current password* / wrong authenticator code on a
  signed-in route returned 401, and the client signs the user out on any 401. Changed to 403
  test-first (7 tests RED, then GREEN).

## Mutation checks

A green test proves little unless breaking the code turns it red. For the security-critical rules
each protection was disabled in turn and the relevant test run.

| Area | Mutation | Result |
|---|---|---|
| Password rehash | drop the compare-and-swap (`AND password_hash = :old`) | **caught** — the old password would be resurrected |
| Google | disable "email links once" | **caught** — a recycled address took over a linked account |
| Phone code | remove attempt cap / expiry / constant-time compare / number binding | **caught** ×4 |
| Phone code | remove single-use; ignore `eligible` | **survived** — other layers still refused; tests rewritten to isolate each, then **caught** |
| MFA | allow replay / widen drift window / reusable recovery code / no lockout / enrolment-only token = full token / secret in clear / switch ignores factor / reset keeps sessions | **caught** ×8 |
| MFA | challenge accepted as access token; challenge shares the API audience | **survived** (overlapping layers) — isolating tests added, then **caught** |
| Review fixes | limiter creates state / no ceiling / never sweeps; enrolment without re-auth; no recency for password-less; no heavy budget; Google skew 0 and huge; headers dropped / applied everywhere | **caught** ×10, none survived |
| Refresh tokens | remove the reuse-detection revocation in `rotate()`; remove `revoke_all_for_user` from `/logout`; always issue a refresh cookie regardless of `scp` | **caught** ×3 (the `/logout` one only after the test fix above) |

Survivors were not a failure of the code — the code had defence in depth — but of the tests, which
now pin each layer independently.

## Security review (`/ecc:code-review`, security pass)

The implementation was reviewed by re-reading the security-critical files, then every finding was
reproduced as a failing test before it was fixed. RED for the round: **19 failed, 137 passed, 9
errors**; GREEN: 165 in the affected files, **586** across the suite.

| # | Sev | Finding | Fix |
|---|---|---|---|
| H1 | HIGH | The rate limiter's `peek()` created a dict entry per key, and login/OTP peek with attacker-chosen text *before* refusing — an unauthenticated memory-exhaustion DoS | Checking never creates state; state exists only while a window is live; periodic sweep; hard ceiling that evicts the oldest first |
| M1 | MED | A stolen **full session** could enrol the attacker's authenticator: owner locked out at next sign-in, attacker keeps access through a password reset | Enrolment re-authenticates: current password (throttled), or for password-less accounts a sign-in < 10 min old. Enrolment-only sessions are exempt |
| M2 | MED | `/switch` and enrolment-promotion re-read `token_version` when minting, so a racing "log out everywhere" was undone | The principal carries the version it was authenticated with; that is what gets stamped |
| M3 | MED | `/password/change` costs ~1 s CPU per call and policy failures were unthrottled | Draws on the heavy per-principal budget (20/min) |
| M4 | MED | google-auth's default clock tolerance is 0 — tokens issued a second "ahead" were rejected as "used too early" | 10 s tolerance; far-future and long-expired still refused |
| M5 | MED | No operator route back in for a lost authenticator if the only admin is locked out | `manage reset-mfa` (+ audit, ends sessions) |
| M6 | MED | Auth responses cacheable; no `nosniff` | `Cache-Control: no-store` on `/api/auth/*`, `nosniff` everywhere |
| L1 | LOW | Public `/api/health/ready` still leaked latencies, error classes, model file names | up/down only |

Reviewed and found sound: SQL (all parameterised; the two f-strings interpolate constants); JWT
handling (algorithm pinned, `aud`/`iss`/all claims required, `typ` guard); the OTP flow's
enumeration behaviour (identical bodies and rate limiting for real and unknown numbers, SMS sent
after the response); WebSocket auth (first-message credential, close codes, periodic re-check, no
CSWSH surface); CORS (no credentials); SSRF (fixed provider URLs); secrets in logs and audit
(masked numbers, no codes/secrets/passwords — asserted by tests).

## Known gaps (unchanged by this work, or accepted)

See [`authentication.md`](authentication.md#known-limitations). In short: no self-service password
reset (no email channel); phone sign-in trusts `customers.phone`; SMS is defeated by SIM-swap
(hence owners only); in-process rate limits. (Phase 7 — the bearer-token-in-`localStorage` /
no-refresh-tokens gap from earlier phases — is now closed; see the Phase 7 table above.)

## What was not verified

* **Google and SMS against the real services.** No client id or provider account exists in this
  environment. The verifier is exercised with a real RS256 token, a locally generated key and a
  fake transport (signature, audience, issuer, expiry, algorithm confusion, skew all run through the
  real `google-auth` code); Twilio is exercised against a mock transport. A live smoke test needs
  your `GOOGLE_CLIENT_ID` and a provider account.
* **A full browser sign-in.** The login screen, phone flow (code request) and tab logic were checked
  in a browser against the running backend, and the WebSocket protocol against the live server both
  directly and through the Vite proxy. Completing a sign-in by typing credentials into the browser
  was left to you.
* **Multi-worker behaviour** of the in-process limiters.

## Reproduce

```bash
cd backend
python -m pytest tests -q                                                    # 600 passed
python -m pytest tests -q --cov=app.auth --cov=app.api_auth --cov=app.api_signin \
       --cov=app.api_mfa --cov-report=term-missing                           # 96%
python -m ruff check app/auth app/api_*.py tests --select E,F,W,I,B --ignore E501,I001,B008
alembic upgrade head        # a1f3c7d92b40 → 278c0878d31e → 1f24c5104eb3 → b23b85a10d62 → ade11682b8b1
```
