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
