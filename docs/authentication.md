# Authentication

How people prove who they are to AutoSaarthi, and what happens next. Authorisation (what a
role may see and do) is separate and lives in [`config/access_policy.yaml`](../config/access_policy.yaml)
— see the RBAC section of the [README](../README.md).

## The model in one paragraph

Every way of signing in ends in the same function, `issue_session()`
([`backend/app/auth/sessions.py`](../backend/app/auth/sessions.py)). The method proves *who* you
are; the funnel then picks a membership, drops any the policy does not allow for that method,
applies the second factor, mints the token and writes the audit line. So a new sign-in method
cannot grow its own idea of a session, and a rule like "only vehicle owners may use SMS" is
enforced in one place.

```
 password ──┐
 Google   ──┼─▶ authenticate ─▶ issue_session ─▶ pick membership ─▶ method allowed for role?
 phone OTP ─┘                                                            │
                                            enrolled in MFA? ─▶ 202 challenge ─▶ /mfa/verify ─▶ session
                                            role needs MFA, not enrolled? ─▶ enrolment-only session
                                            otherwise ─▶ session
```

## Sign-in methods

| Method | Endpoint | Who | Notes |
|---|---|---|---|
| Email + password | `POST /api/auth/login` | any role | PBKDF2-HMAC-SHA256, 600k iterations; hashes made at a lower cost are upgraded on the next successful login |
| Google | `POST /api/auth/google` | any role, **pre-provisioned users only** | Google proves who you are; it does not decide who may use AutoSaarthi. Bound to Google's `sub`, never the email |
| Phone number + code | `POST /api/auth/otp/request`, `/otp/verify` | **`vehicle_owner` only** | SMS is only as strong as the phone number's owner (SIM-swap), so no role that reads other people's data may be reached this way |
| Second factor (TOTP) | `POST /api/auth/mfa/verify` (+ enrol/confirm/disable/recovery) | roles marked `mfa_required` | authenticator app + 10 single-use recovery codes |

`GET /api/auth/config` (public) says which of these this deployment offers, so the login screen
never shows a button that would fail.

Which methods a **role** may use, and whether it needs a second factor, are two lines in the
policy file next to its grants:

```yaml
vehicle_owner:
  login_methods: [password, google, phone_otp]
  mfa_required: false
```

A role that says nothing gets password only and *requires* MFA — a new role has to opt out
explicitly.

### Sessions

* JWT (HS256, key pinned) carrying `iss`, `aud`, `sub`, `org`, `role`, `tv`, `amr`, `scp`, `jti`, `iat`, `exp`;
  every one is required. `amr` records how the session was authenticated (`["password"]`,
  `["google","totp"]`, …) and `/switch` consults it, so a session proven by SMS cannot be moved
  into a role that forbids SMS.
* `tv` is compared with `users.token_version` on **every request**, together with a fresh check of
  the membership and the user's active flag. Logging out, an administrator revoking sessions, a
  password change, or an MFA reset bumps it and every outstanding token dies immediately.
* `scp` is `full`, or `mfa_enroll` — a token that can enrol in a second factor and sign out,
  nothing else. It is what a user whose role *requires* MFA holds until they set it up.
* The second-factor **challenge** is signed for a different audience (`autosaarthi-mfa`), so it
  cannot be used as a bearer token however it leaks.

### Refresh tokens

The access token is short-lived (15 minutes — `scp: full` and `scp: mfa_enroll` now expire at the
same rate). What keeps a session alive past that is a **refresh token**, in an httpOnly cookie
(`refresh_token`, `Path=/api/auth`, `SameSite=Lax`, `Secure` in production) that JavaScript on the
page cannot read — the mitigation the previous section's `localStorage` risk was waiting on.

* `POST /api/auth/refresh` trades the cookie for a new access token. It re-reads the membership and
  `is_active` from the database every time — the point of a short-lived access token is that this
  check happens every 15 minutes, not whenever a 12-hour token happened to expire.
* The refresh token **rotates on every use**: `/refresh` consumes the one presented and sets a new
  one, single-use, same as the one before it. Only a keyed hash of it is ever stored (see
  [`backend/app/auth/refresh.py`](../backend/app/auth/refresh.py)).
* **Reuse is theft.** Presenting a refresh token that was already rotated away — the legitimate
  client moved on, someone else replayed an older copy — revokes every token in that chain *and*
  bumps `token_version`, signing out the access token too. Both sides have to sign in again.
* **…except within 20 seconds, which is a race.** Two tabs, or a reload while a refresh is in
  flight, send the same cookie twice in one second. That answers `409` and changes nothing; the
  browser's cookie jar already holds the winner's token, so the client retries once and succeeds.
  The accepted cost: a replay inside that window is not detected (it still gets no token).
* A refused refresh (unknown, expired, revoked, or the account no longer valid) answers `401`
  **and clears the cookie**.
* It is revoked everywhere a session already is: `/logout`, an administrator's
  `/revoke-sessions`, a password change, an MFA reset (API or `manage reset-mfa`), and
  `manage deactivate` / `manage set-password`.
* An **enrolment-only** (`mfa_enroll`) session gets no refresh cookie — it is a half-signed-in
  state on purpose; silently extending it would defeat the reason it is short.

### WebSocket

`/ws/events` carries UEBA, red-team and job activity. A browser cannot set a header on a WebSocket
and a token in the URL would be logged, so the credential is the **first message**:
`{"type":"auth","token":"…"}`. Nothing is sent until it checks out; the server closes with `4401`
(no usable credential) or `4403` (known but not allowed — the stream needs `ueba:read`), and
re-checks the token every 30 s so revocation cuts a live stream.

## Configuration

Everything is an environment variable (see [`.env.example`](../.env.example)).

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` refuses to start on unsafe defaults and refuses to seed demo accounts |
| `JWT_SECRET` | *(generated in dev)* | **Required in production**, ≥ 32 characters. In development it is generated once and kept in `data/.jwt_dev_key` (git-ignored) |
| `MFA_ENFORCEMENT` | `0` | `1` makes every `mfa_required` role need a second factor |
| `MFA_ENCRYPTION_KEY` | *(derived in dev)* | **Required in production.** Fernet key protecting TOTP secrets at rest |
| `GOOGLE_CLIENT_ID` | *(off)* | Turns Google sign-in on |
| `SMS_PROVIDER` | `console` | `console` logs the code (dev only, refused in production), `twilio`, or `none` |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM` | | Real SMS |
| `OTP_SMS_TEMPLATE` | see `.env.example` | In India the operator must have this exact text registered (TRAI DLT) |

Production start-up fails, with a message that says what to set, if `JWT_SECRET` is missing or
weak, if `MFA_ENCRYPTION_KEY` is missing or malformed, or if the SMS template cannot carry a code.

### Setting up Google sign-in

1. Google Cloud Console → *APIs & Services → Credentials → OAuth client ID → Web application*.
2. Add your frontend origin under **Authorised JavaScript origins**. Google accepts
   `http://localhost:5173` but **not** a raw IP or plain HTTP elsewhere — so it cannot work from a
   phone at `http://192.168.x.x:5173`; use an HTTPS tunnel or hostname for that.
3. Put the client id in `GOOGLE_CLIENT_ID`. The button appears; nothing else to do.
4. Provision the people who may use it (below) — an unknown Google account is refused.

### Setting up SMS

`SMS_PROVIDER=console` needs nothing: the code is printed in the backend log (marked *DEV-ONLY*).
For real delivery use Twilio and, for Indian numbers, register the message text as a DLT template.

## Provisioning accounts

```bash
cd backend
python -m app.auth.manage create-user --email a@b.com --name "A B" --org ORG-RAMAN --role fleet_manager
python -m app.auth.manage create-user ... --password-prompt      # with a password (asked, never in argv)
python -m app.auth.manage add-membership --email a@b.com --org ORG-CUSTOMERS --role vehicle_owner
python -m app.auth.manage deactivate --email a@b.com             # also ends their sessions
python -m app.auth.manage set-password --email a@b.com
python -m app.auth.manage reset-mfa --email a@b.com              # lost authenticator
```

A user created without a password can only come in by Google or a phone code. Vehicle owners
need no provisioning: the first sign-in with a number that is on a `customers` row creates the
account and links the customer records.

An administrator can also end someone's sessions (`POST /api/auth/users/{id}/revoke-sessions`) or
reset their second factor (`POST /api/auth/users/{id}/reset-mfa`) through the API.

## Operations

* **Audit.** Every sign-in, refusal, identity link, code request, enrolment, reset and password
  change is written to `access_audit` with the method and a reason. Phone numbers are masked
  (`+91*******044`); codes, secrets and passwords are never written anywhere.
* **Behind a reverse proxy**, start uvicorn with `--proxy-headers --forwarded-allow-ips=<proxy>`.
  The per-address limits key on the client address; without this every user shares the proxy's and
  they throttle each other.
* **Rate limits** are in process (per worker, reset on restart). They are bounded — the table cannot
  be exhausted — but a multi-node deployment should put the same interface on Redis.
* **Rotating `JWT_SECRET`** signs everyone out. With `MFA_ENCRYPTION_KEY` set it does *not* orphan
  enrolled users; without it (development only) it does.

## Known limitations

Stated plainly, because a security document that lists only strengths is not one.

* **No self-service password reset.** There is no email channel. An administrator uses
  `set-password`; users can change their own password when signed in.
* **Phone sign-in trusts the `customers.phone` column.** Whoever can write that column can take over
  that owner's phone sign-in. Nothing in the API writes it today; if an endpoint ever does, treat it
  as an authentication-sensitive operation (re-authenticate, audit, notify the old number).
* **Recycled and swapped numbers.** A number reassigned by the carrier, or a SIM-swap, defeats any
  SMS code. The controls are the ones a service can apply: owner roles only, five guesses, five
  minutes, single use, and a session that cannot be switched into a staff role.
* **The MFA challenge is not single-use** once it succeeds (it lives five minutes). Replaying it
  still needs a fresh authenticator code, which is replay-protected, so it gains an attacker nothing
  they do not already hold.
* **Google sign-in by email is only as trustworthy as the mailbox.** The first link between a
  provisioned user and a Google account is made on a *verified* email; after that the stable `sub`
  is used, and a second Google account claiming the same address is refused.
* Password hashing is PBKDF2 (standard library) rather than Argon2 to avoid a native dependency.
