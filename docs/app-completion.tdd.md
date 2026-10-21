# App completion — TDD evidence report

The running record for the plan agreed on 2026-10-13: refine and unify the web design, make the
car screen real, then build the React Native (Expo) owner app with Android Auto. One section per
phase. Every command and outcome below was actually run; where something was not done, it says so.

- **Source.** No `*.plan.md`; the plan (Phases 0–6) and the design audit that fed it were agreed in
  conversation. Journeys were derived during the run.
- **Runners.** Backend: `python -m pytest tests -q` in `backend/` (project `.venv`). Frontend:
  `npm test` (Vitest 3, jsdom, Testing Library), `npm run test:coverage`, and
  `npx playwright test` (Playwright 1.64 driving the installed Microsoft Edge).
- **No checkpoint commits.** Commits are made only when asked; this report holds the RED/GREEN record.

---

## Phase 0 — fixes and test harness

### User journeys

| # | As a… | I want to… | so that… |
|---|---|---|---|
| 1 | vehicle owner | have one upcoming booking, however many times I say yes | my car does not hold five bays (it did) |
| 2 | service manager | read slots, statuses and who booked in plain words | the table is not `9/5/2026, 12:00:00 PM` and `scheduling_agent` |
| 3 | driver | read "1 day", never "1 days" or "0 days" | the one line I glance at is right |
| 4 | owner | sign in to *my* app, not "the OEM console" | I know I am in the right place |
| 5 | anyone | read amber status pills | 11px text clears 4.5:1 |
| 6 | owner with two tabs | stay signed in when a reload races a refresh | a race is not mistaken for theft |
| 7 | the team | see any visual change the restyle makes | demo slides do not change unnoticed |

### RED → GREEN

| Behaviour | Tests | RED | GREEN |
|---|---|---|---|
| One upcoming booking per vehicle; replaced holds free their bay; bookings for one car serialise | `backend/tests/test_scheduling.py` (12) | 7 failed, 4 passed — e.g. `assert True is False` (a booked car held a second slot), `assert 2 == 1` active bookings | 12 passed |
| Shared formatter: plurals, days, ₹, dates and slots in IST, labels | `frontend/src/lib/format.test.js` (26) | `Failed to resolve import "./format.js"` | 26 passed, 100% coverage |
| Screen copy: in-car / owner "1 day", "rate limit(s)", Service Ops row, owner subtitle | `frontend/src/pages/copy.test.jsx` (13) | 12 failed — e.g. `Unable to find … /About 1 day of driving left/` | 13 passed |
| Pill contrast ≥ 4.5:1, day and night | `frontend/src/device.test.jsx` (4) | amber/day `expected 1.9145… to be ≥ 4.5` | 4 passed |
| Refresh race → 409 + retry; dead cookie cleared | `backend/tests/auth/test_refresh.py` (+4, 1 changed), `frontend/src/api.test.js` (5) | 3 + 1 backend, 2 frontend failed | 18 + 5 passed |

Totals at the end of Phase 0: **backend 616 passed** (incl. the live-server tenancy and revocation
suites against `:8010`), **frontend 48 passed**, production build OK, ruff clean on changed files
(two pre-existing B904s in `api_chat.py` untouched).

### Mutation checks

| Mutation | Result |
|---|---|
| Cancel releases a bay even for an already-cancelled booking | caught |
| Drop the vehicle row lock in `hold_slot` | **survived twice**, then caught — see below |
| Drop the "upcoming only" time filter | caught |
| A replaced hold keeps its bay | caught |
| Formatter: no under-a-day guard / always plural / no IST offset | caught ×3 (2, 9, 5 tests) |
| Refresh: no grace window / refusal keeps the cookie | caught ×2 |
| Baseline: one word changed on a screen | caught (889 px) |
| Baseline: one letter's case changed | **not caught** — under the 20 px allowance; accepted |

### Process notes worth keeping

* **A concurrency test that proved nothing.** Two threads booking the same car passed with the lock
  removed, five runs out of five: the window is too narrow to hit. Replaced by a deterministic test
  that holds the vehicle's lock itself and asserts a booking waits. That one *also* passed without
  the lock — inserting the appointment takes a foreign-key share lock that `FOR UPDATE` blocks on
  its own. With `FOR NO KEY UPDATE` (which conflicts with the booking lock but not the FK check) it
  goes red without the lock and green with it.
* **Two false greens caught.** `/within 1 day/` matched "within 1 days"; anchored. The first
  baseline waited for `.animate-pulse`, which this app never renders (its skeletons are
  `.skeleton`), so it could have captured half-loaded screens; fixed and re-captured.
* **A tolerance that hid real changes.** At 3%, and at 0.2%, the baseline let a changed date
  format and badge through. At zero, only the two screens actually changed differed — every other
  screen renders identically run to run — so the allowance is now 20 px, with the Security
  Console's live counters masked and its growing feeds outside the captured viewport.
* **Found in live verification, not by tests:** the refresh race (above) and the dropped cookie
  deletion. Both now have tests.

### Known gaps / follow-ups

* **Old duplicate bookings remain in the demo database** (KA05XY1009 ×5, MH12AB1001 ×2), made before
  the fix. `python scripts/reset_demo.py` clears them; not run here because it resets all demo state.
* `cancel_appointment`'s old unfiltered bay release never reproduced as a bug in tests (heap order
  kept picking the right row); it now filters by state, covered by the double-cancel test.
* The owner web app has **no sign-out** once an owner is signed in → Phase 2.
* The in-car slot (`Tue 09:30 · Rajkot`) is still hardcoded and its Book button still local-only →
  Phase 3, as planned.

---

## Phase 1 — shared packages and tokens

npm workspaces at the repo root (`frontend`, `packages/tokens`, `packages/core`; `mobile` joins in
Phase 4), one root lockfile. See [design-system.md](design-system.md).

| Behaviour | Tests | RED | GREEN |
|---|---|---|---|
| Tokens: day/night parity, hex format, text ≥ 4.5:1 on every surface in both modes, badge ink on its tint, monotonic scales, generated CSS in sync, legacy names keep today's values | `packages/tokens/src/tokens.test.js` (87) | `Cannot find module '../scripts/build-css.js'` | 87 passed — every existing colour already met its bar |
| Formatter moved to `@autosaarthi/core` | `packages/core/src/format.test.js` (26) | — (moved, unchanged) | 26 passed, 100% |
| Head unit no longer shows "All systems nominal" while the verdict is loading | `frontend/src/pages/InCarConsole.test.jsx` (3) | 2 failed, 1 passed (the pinned healthy screen) | 3 passed |

**Zero visual change, proven:** with the token source wired in, 7 of 8 screens matched the strict
baseline exactly; the 8th (in-car) differed only in the live guard-verdict list below the head unit,
whose steps depend on rate-limit state — the in-car capture is now the viewport.

Mutations: a legacy value drifting, a night token missing, a hand-edited `tokens.css` → caught ×3.

### Found along the way

* **Fonts depended on Google's CDN.** A slow fetch swapped the whole app to Segoe UI mid-run (the
  baseline caught it). Fonts are now bundled; the bundled build differs from the CDN build by 22–47 px
  of antialiasing on a few letter pairs — accepted, baseline re-captured, stable twice.
* **Loading looked like healthy on the head unit** (above) — a safety-relevant state bug, found
  because the baseline captured the screen mid-request.
* Workspace hoisting split Vitest from jsdom; fixed by declaring shared test tools at the root.

---

## Phase 2 — web refinement

See [design-system.md](design-system.md) for what changed and why. Every visual change was reviewed
as a screenshot diff before the baseline accepted it.

| Behaviour | Tests | RED | GREEN |
|---|---|---|---|
| Pages on semantic names; retired names never return | `src/test/legacy-names.test.js` (22) + token test | token test 1 failed (legacy defined) | pixel-identical baseline, then guarded |
| No hex colour in components; orange never used as text | `src/test/no-raw-colours.test.js` | 3 files with hex; 6 with orange text | passing |
| New tokens: positive / alert / chrome / hatch / control / link / white-on-accentDeep, all contrast-checked | `packages/tokens` (+16) | 18 failed (missing), then 6 (`link`) | 87 passing |
| Every font size on the 10-step scale | `src/test/type-scale.test.js` | 16 files off-scale | passing |
| Healthy owner screen: readable sensor names; no empty sparklines | `OwnerApp.test.jsx`, `packages/core/src/signals.test.js` | 2 failed; core import missing | passing |
| Owner can sign out on the phone (not in the console preview) | `OwnerApp.test.jsx` | 1 failed | passing; verified live, reload stays signed out |
| Dialog: named, modal, Escape, click-outside, focus in/out, Tab trapped, portalled | `src/ui.test.jsx` (7) | all failed (no component); portal test failed after a live finding | 7 passing |
| Section nav `aria-current`; account menu `aria-expanded`/Escape/click-outside | `src/App.test.jsx` (6) | 3 behavioural fails | 6 passing; verified with a real keyboard |
| Owner night mode follows the phone; links readable at night; sign-out stays dark | `src/night.test.jsx` (7) | module missing; then link `'' ≠ rgb(255,128,96)`; nested theme `undefined ≠ night` | 7 passing; verified on an emulated dark phone |

Totals: frontend **136**, core **34**, tokens **87**; backend unchanged at 616. Build OK, baseline 8/8.

### Found along the way

* **The planned grey merge would have broken contrast.** Merging the owner kit's darker grey into
  the console's lighter one dropped it below 4.5:1 on the head unit's status bar; the token tests
  failed, and the merge went the other way.
* **Three more contrast failures** surfaced by tokenising: status green 3.5:1, white on orange
  3.4:1, orange text 2.9:1 — all fixed and now guarded.
* **Dialogs rendered under the sticky header** in a short window (seen live): the page's entrance
  animation makes a stacking context. Dialogs are now portalled to `<body>`.
* **A night-mode bug the first fix did not fix.** Signing out turned a dark phone's sign-in screen
  light; "restore the previous value" failed because React runs a child's effect before its
  parent's. A count of night holders replaced it.
* **A RED for the wrong reason, twice:** a test asserted text content on an icon-only button, and a
  test looked for a link the mock data never rendered. Both fixed before the production change.
* **The screenshot baseline itself needed work.** A 0.2 per-pixel colour tolerance hid hue changes
  (tightened to 0.02, re-baselined from the committed code); loading text, not just skeletons, had
  to be waited for. The two sign-in screens flickered through every fix tried (a bold glyph, a
  label mid-transition), so they are checked for content instead of pixels — recorded, not hidden.

### Reproduce

```bash
cd backend && python -m pytest tests -q                 # 616 passed (needs the backend on :8010)
npm test                                                # all workspaces: frontend 136, core 34, tokens 87
npm run tokens                                          # regenerate tokens.css after editing the source
cd frontend && npx playwright test                      # 8 screens vs. baseline (dev servers running)
```

## Phase 3 — backend for the phone and the car

The mobile app and Android Auto need things the web app never did: a session a phone can hold, a
car screen whose drive state the server decides, booking from that screen, and somewhere to send
notifications. The web In-Car Console was then rebuilt on the same car screen.

### User journeys

* As an owner on the phone, I stay signed in without a cookie, and signing out ends it everywhere.
* As a driver, the head unit shows only what is safe for what the car is doing, and lets me book
  only when parked — decided by the server from the car's own readings, not by the screen.
* As an owner, the app tells me when something needs attention or a booking is confirmed; a
  signed-out or handed-down phone stops getting my alerts.
* As a demo operator, I can change what the car reports and watch the screen follow.

### RED → GREEN

| Behaviour | Tests | RED | GREEN |
|---|---|---|---|
| Mobile sessions: refresh token in the body, never a cookie; token families bound to the client that got them; a cookie can't be replayed as an app token or the reverse | `tests/auth/test_mobile_sessions.py` (12) | all failed (no `X-Client`, no body token) | passing |
| Car screen: drive state from the latest telemetry; none / stale (>120 s) / parked-at-speed all count as moving; the client can't assert its own state | `tests/test_car.py` | module missing | passing |
| What the screen may show comes from the G6/G7 rules, read without invoking a tool; slots never sent while moving; costs from `vehicles.yaml` | `tests/test_car.py` | as above | passing |
| Book from the car: only when parked, only a slot in the car's own city, through the guarded scheduler; booking twice keeps one | `tests/test_car.py` | as above | passing |
| The screen reports an upcoming booking and offers no more slots; a past appointment is not a booking | `tests/test_car.py` (+3) | `KeyError: 'booking'` | passing |
| `/api/console/demo` retired (it ran the console tools with the page's own drive state) | `tests/test_car.py` | 200 | 404 |
| Demo drive-state control: red-team permission and demo mode only; the screen says whether this caller has it | `tests/test_car.py` (+2) | `KeyError: 'controls'` | passing |
| Push devices: register / list (hint, never the token) / forget own; a token moves to whoever signed in last; at most 10 per account; only Expo tokens from android/ios | `tests/test_push.py` | `ImportError: app.push` | passing |
| Ending sessions forgets the phones (logout, admin revoke, and every other `revoke_all_for_user` caller) | `tests/test_push.py` | as above | passing |
| `notify.push` delivers (was a stub answering `{"sent": true}`): honours `consent_push`, forgets uninstalled apps, reports an outage instead of raising | `tests/test_push.py` | as above | passing |
| Expo sender: correct JSON, bearer only if configured, `DeviceNotRegistered` only; errors carry no URL or credential; console sender refused in production | `tests/test_push.py` | as above | 29 passing |
| Web head unit built only from the car screen: real costs (none invented), the server's slot in the car's city, booking through the API, refusals shown, bookings shown, no tap target when touch is not allowed, no speed from a stale reading, never one car's screen for another, polls every 10 s | `src/pages/InCarConsole.test.jsx` (24), `copy.test.jsx` | 19 failed on the old component | 24 passing |

Totals: backend **685** (from 650 at the end of 3c), frontend **157**, core **34**, tokens **87**.
Visual baseline 8/8, run twice.

### Mutation checks

| Area | Mutations | Result |
|---|---|---|
| Mobile sessions | header chooses the refresh mode, and others | M3 survived at first: the binding check also refused the request, so the test passed for the wrong reason. Strengthened to require a 200 cookie refresh; then caught |
| Car screen and booking | 7 | all caught |
| Car screen: booking, past appointments, demo control | 5 | 1 survived (a past appointment counted as a booking — no test had one); test added, then caught |
| Push | 17 | all caught |
| Web head unit | 16 | all caught, after three tests were strengthened *before* running them: the touch-blocked test had no slots (so the button was disabled anyway), "Other times" never checked which slot got booked, and nothing covered a slow answer about the previous car |

### Found along the way

* **The web head unit could only ever say "moving" here.** With no simulator streaming and demo
  mode off in the dev `.env`, every car's latest reading is old, so the server — correctly — treats
  it as moving. The old page showed a parked screen because it assumed one.
* **"0 km/h" beside a locked screen** — the speed of a stale reading. Only a live reading's speed is
  shown now.
* **A control that could not work.** The drive-state buttons appeared for anyone with `redteam:run`
  and the server then refused them outside demo mode. The server now says whether the control is
  available, and the page shows it only then.
* **The screenshot baseline broke at midnight.** Service Ops' forecast is a 14-day window from today
  and a CAPA draft id carries the date; both are now masked. The headline numbers above the forecast
  come from the same window — they did not move this time, but could.
* **The brief-stop screen offered two tap targets G6 refuses.** They now appear only if the server
  allows touch, which at a brief stop it does not.

### Known gaps / follow-ups

* Push delivery needs an Expo project with FCM credentials uploaded — the owner's to set up (Phase 4).
  Until then `PUSH_PROVIDER=console` logs notifications in development.
* The red-team scenario that shows a tap blocked at speed is ATTACK-5 (Security Console); the in-car
  page no longer fires guarded calls itself.
* Untouched files still have ruff findings (`ml/predict.py`, `rca/corpus.py`, `ueba/baseline.py`,
  `ueba/guard.py`, `tests/test_ueba_redteam.py`).

### Reproduce

```bash
cd backend && python -m alembic upgrade head            # refresh_tokens.client, push_devices
cd backend && python -m pytest tests -q                 # 685 passed (needs the backend on :8010)
npm test                                                # frontend 157, core 34, tokens 87
cd frontend && npx playwright test                      # 8 screens vs. baseline (dev servers running)
```

## Phase 4 — the owner's phone app (in progress)

Expo SDK 58 (React Native 0.88, React 19), TypeScript and Expo Router in `mobile/`. It keeps its
own install — the web app is on React 18 — and links `packages/tokens` and `packages/core`. Setup
and layout: [mobile/README.md](../mobile/README.md).

### User journeys

* As an owner, I sign in on my phone with a password or a code by SMS, and stay signed in — offline
  included — until I sign out or the server ends the session.
* I open the app and see one sentence about my car: quiet when healthy; what is wearing, how long
  is left and what each choice costs when not.
* I see why the app thinks so, book or move or cancel the service myself, or talk it through with
  the agent.
* My phone tells me when something needs attention, and a signed-out phone stops.

### RED → GREEN

| Behaviour | Tests | RED | GREEN |
|---|---|---|---|
| Owner booking from the phone, not gated on drive state: book, move in one transaction (a slot taken meanwhile keeps the old booking), cancel; one booking per car; city and scope checked; attributed to `owner_app` | `backend/tests/test_service.py` (16) | 15 failed — no routes (one passed only because the route was missing; covered by a mutation) | 16 passing |
| Component names, verb agreement and the reading that shows each part's wear, shared | `packages/core/src/components.test.js` (5) | module missing | 39 passing in core |
| API client: refresh token in the body and secure storage; one refresh however many requests wait; only a *refused* refresh signs out — offline or a 5xx does not; logout forgets locally even offline | `mobile/src/lib/api.test.ts` (18) | module missing; then offline vs busy not told apart | 18 passing |
| Sign in: email, phone code, second factor; methods the server turned off not offered; validation before sending; one request per submit | `mobile/src/screens/SignIn.test.tsx` (8) | module missing; then notices were not one accessibility element (a TalkBack fix) | 8 passing |
| Home, evidence, history, booking, agent, account, offline banner | `mobile/src/screens/*.test.tsx`, `OfflineBanner.test.tsx` | module missing for each, run before writing the screen (Home excepted — written first, so its mutations stand in for RED) | passing |
| Push registration only on a device, with permission and an EAS project; channel before the Android 13 prompt; a tapped notification opens only the app's own screens | `mobile/src/lib/push.test.ts` (19) | module missing | 19 passing |

Totals: backend **701**, mobile **89**, frontend **157**, core **39**, tokens **87**. Mobile
typecheck and lint clean.

### Mutation checks

| Area | Mutations | Result |
|---|---|---|
| Owner booking routes | 12 | all caught |
| API client | 12 | 2 survived — both redundant code (a guard on a path sign-in never takes; a check the refresh step already makes). Removed |
| Sign in | 7 | 2 "survived" individually: the in-flight ref and the busy button each stop a double submit. Removing both together is caught |
| Home, car loading | 5 + 4 | all caught (the loader was rewritten for the React Compiler's rules and re-checked) |
| Book | 7 | 1 equivalent mutant (same behaviour, nothing to catch); the rest caught |
| Evidence | 5 | 2 survived — the engine-off reading sat mid-series and only one prediction existed. Test data fixed; caught |
| Agent | 7 | all caught |
| Push | 6 | all caught, after a lookalike link (`other://book`) was added |

### Found along the way

* **A fixture the server never sends.** The test session carried `name`; the server sends
  `full_name`. Every test passed and the live Account screen showed no name. Fixtures were checked
  against live responses after that; only this one was wrong.
* **Testing Library 14 is async**: `render` and `fireEvent` return promises. And on Android a view
  with a role must be `accessible` to be one TalkBack element — the error notices were not.
* **The React Compiler's lint rules** (on in the SDK 58 template) found a ref read during render and
  state set synchronously in effects; fixed rather than silenced. One rule (`import/namespace`)
  cannot see an `export *` re-export and is suppressed on that one line with the reason.
* **Flaky under load**: with the backend suite and Metro running, 1–7 screen tests exceeded Jest's
  5 s limit. Reproduced by running suites side by side; the wait and test limits were raised, with
  the reason in `mobile/jest.after-env.ts`.
* **The demo database has no future service slots** — capacity ends on 12 Sep 2026 — so the phone
  (correctly) says none are open. Re-seeding capacity is the owner's call.
* **The web owner app still quotes repair costs from its own table** (the same bug the in-car
  console had). The phone uses the server's.

### Verified live (browser preview, `localhost:8081`)

Sign-in as a seeded owner; Home quiet for a healthy car and an alert with the server's costs for
another; evidence with the model's confidence; booking screen with no open slots; history; account;
the protected routes returning to sign-in after a reload (the preview keeps no token); dark mode
taking the night tokens. Not done yet: an Android emulator run, push on a device, Maestro flows.

## Design critique — fixes

A design critique of the web app and the phone app (skills: `ecc:design-system`,
`ecc:frontend-design-direction`, `ecc:make-interfaces-feel-better`, `ecc:accessibility`,
`ecc:react-native-patterns`, `frontend-design`) found 24 issues. These were fixable without a
decision from the owner; the brand mark, the console's card layout and the label voice were
left for one.

| Fix | Tests | RED | GREEN |
|---|---|---|---|
| `borderStrong` (3:1 on every surface, day and night) for fields, selects and radio rings; a 4-point `space` scale | `packages/tokens/src/tokens.test.js` (+12) | 10 failed (missing tokens) | 98 passing |
| Owner words shared by phone, web owner app and head unit: "Urgent / Soon" not P1/P2, "83% · Likely" not 0.83, a trend claimed only when the readings show it | `packages/core/src/owner.test.js` (18), `formatDay`, `formatClock`, `featureLabel` | module/functions missing | core 67 passing |
| Phone: staff turned away (as the web owner app does); opens on phone sign-in; Home and the alert card rebuilt on the web owner card; evidence honest; one title per screen; pull-to-refresh feedback; refetch on returning to the app; responses checked with Zod | `mobile/src/**` (+11) | 12 failed — then fixtures that sent a vehicle with no VIN were rejected by the new schema, and corrected | 100 passing |
| Web: fleet vehicles are buttons (a `<tr onClick>` could not be reached by keyboard — WCAG 2.1.1, missed by the critique's own search); the list says how many it holds; the anomaly-detector note is reviewed wording, not the artifact's internal note; model features in words; both charts have a text alternative; the chosen centre is `aria-pressed` | `FleetMonitoring.test.jsx` (5), `ServiceOps.test.jsx` (2) | 7 failed for the intended reasons | passing |
| Four white-text buttons lightened to the plain accent on hover (3.4:1) — now darken; red-team buttons outlined; every field outlined at 3:1 | guards in `no-raw-colours.test.js`, `control-outline.test.js`, `login/parts.test.js` | 5 files flagged, then 1 more (the owner chat input) once the guard read past `=>` | 240 passing |
| Head unit: the real time (masked in the screenshot test), the car's city instead of a fake "LTE fuel 46%", owner words on its badges | `InCarConsole.test.jsx` (+4) | 4 failed | passing |
| Web owner app: the same owner words, confidence and trend rules; the alert glow from the token, not a raw `rgba` | `OwnerApp.test.jsx` (+4) | 9 failed (incl. the renamed "Why this part?") | 41 passing with copy tests |

**Mutation checks:** phone 11/11, core 6/6, web 13/13 caught.

**Visual baseline:** four screens changed (fleet, in-car, security, owner home), each reviewed as a
screenshot before accepting; 8/8 on two runs after. The fleet list now fits its ten vehicles whole.

**Found along the way**

* **The critique missed a keyboard trap.** Its search for clickable non-buttons read one line at a
  time; the fleet row's `onClick` sat on the line after `<tr`. A multi-line search found it.
* **The new response schema caught test fixtures**, not app bugs: three screens' fixtures sent a
  vehicle with no VIN — the shape the server never sends.
* **Another session edited this checkout at the same time** (the web owner app's costs). Its files
  were left alone until it finished, then built on.

**Left for the owner:** the brand mark (app icon, splash, favicon), flattening the console's
card-in-card layout and KPI tiles, and the label voice (all-caps monospace labels everywhere).
Not done by choice: the head unit's deck-matched spacing (26 px and friends) was not moved onto the
4-point scale.
