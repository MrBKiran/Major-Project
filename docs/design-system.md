# Design system

One source of design tokens for every AutoSaarthi surface: the staff console, the owner web app,
the head unit, and (from Phase 4) the React Native app and its Android Auto screens.

| | |
|---|---|
| Source | [`packages/tokens/src/index.js`](../packages/tokens/src/index.js) — plain JS, read by Vite, Node and Metro |
| Web | `packages/tokens/tokens.css`, **generated** (`npm run tokens`), imported by `frontend/src/index.css` |
| Formatting | [`packages/core`](../packages/core/src/format.js) — dates, ₹, plurals, labels; one house style everywhere |
| Fonts | Space Grotesk + JetBrains Mono, **bundled** (`@fontsource/*`), not fetched from Google Fonts |
| Guards | `packages/tokens/src/tokens.test.js` (87 tests) + the screenshot baseline (`frontend/e2e/`) |

## Rules

1. **No hex values in components.** Take colours from the tokens — `bg-surface-card`,
   `text-fg-muted`, or `mode(night).fg` in inline-styled kits.
2. **Every token has a day and a night value.** Phones follow the system theme; the head unit
   switches at dusk. A test enforces parity.
3. **Every text token clears 4.5:1** on page, panel and card, in both modes — this app's dimmest text
   is 11px, so the large-text 3:1 allowance never applies. Badge ink is checked on its own 10% tint.
4. **Semantic names only** (`surface-*`, `fg-*`, `border`). The legacy `ink-*` / `slate-*` names were
   removed in Phase 2, and a test keeps them out.
5. **Times are IST**, built by `formatSlot` / `formatDate` / `formatDay` / `formatClock` — never
   `toLocaleString`.
6. **A control's outline is `borderStrong`** (3:1, WCAG 1.4.11) — text fields, selects, a radio's
   ring. `border` (~1.3:1) is for dividers.
7. **Owners read owner words.** Severity is "Urgent / Soon / Worth watching", never P1/P2/P3;
   confidence is "83% · Likely", never 0.83; a trend is claimed only when the readings show it. The
   words live in `packages/core` (`OWNER`, `alertBadge`, `confidence`, `trendSentence`) and are
   shared by the phone, the web owner app and the head unit.
8. **The phone spaces on the 4-point `space` scale** from the tokens; the web uses Tailwind's,
   which is the same step.
9. **Labels speak in sentence case.** No all-caps, no letter-spacing. Monospace is for data a person
   might copy (a VIN, a code, a slot id), never to make a label look technical.
10. **One surface per idea.** A page's headline figures are one `StatStrip`, not a row of
    separate cards; a card does not hold more cards — rows are divided by a line.
11. **One mark, drawn once.** The AutoSaarthi mark is `design/brand/road.svg`: an A drawn as a
    road narrowing to the horizon, its centre-line dashes the crossbar. Every icon — the phone's
    app icon, Android adaptive and themed layers, both splash marks, the favicons — is rendered
    from it by `node design/brand/render.mjs`, in token colours; nothing is drawn by hand. White
    on the plain accent is 3.4:1: enough for the mark (a graphic, 3:1), never for text.
12. **A header holds still.** Tab labels never break; below `xl` the console drops the
    "OEM Console" caption and shows the account menu as its avatar (its words stay for a screen
    reader), and below that the tab row scrolls. Anything that changes width as it runs — the
    head unit's clock — reserves its widest width, so nothing beside it moves.

## Tokens

**Surfaces:** `page` `panel` `card` `inset` `insetStrong` · `border` `borderStrong` · `hatch`.
**Text, most to least prominent:** `fgStrong` `fg` `fgSecondary` `fgTertiary` `fgMuted`
`fgSubtle` (+ `fgDecorative`, fills only). **Brand / severity:** `accent` `accentDeep`, `p1` `p2`
`p3` `ok` and their `*Ink` variants. **Charts:** `grid` `axis` `baseline` `predicted` `capacity`
`temp` `volt`.

**Type — ten steps** (was 27 sizes): `caption` 11 · `label` 12 · `bodySm` 13 · `body` 14 ·
`lead` 15 · `titleSm` 17 · `title` 21 · `display` 27 · `displayLg` 31 · `hero` 38 — Tailwind `text-caption` …

**Radius:** `chip` 6 · `control` 10 · `card` 12 · `panel` 16 · `pill` 999 — `rounded-card` …

**Space:** 0 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 48 (`space[1]` … `space[12]`), for the phone.

## Enforced by tests

These are not conventions; a test fails when they are broken.

| Rule | Guard |
|---|---|
| No hex colour in a component | `frontend/src/test/no-raw-colours.test.js` |
| The brand orange is never text (2.9:1 on the page) — text uses `accentInk` / `link` | same file |
| Every font size is a step on the scale | `frontend/src/test/type-scale.test.js` |
| No retired `ink-*` / `slate-*` / `edge` names | `frontend/src/test/legacy-names.test.js` |
| Every token has day + night; every text token ≥ 4.5:1 on every surface, in both modes | `packages/tokens/src/tokens.test.js` |
| White text sits on `accentDeep` (4.8:1), never the plain accent (3.4:1) | same file |
| …including on hover: a white-text button darkens (`accent-ink`), never lightens | `frontend/src/test/no-raw-colours.test.js` |
| Every input, select and textarea is outlined at 3:1 | `frontend/src/test/control-outline.test.js` |
| `borderStrong` clears 3:1 on every surface, both modes; spacing is a 4-point scale | `packages/tokens/src/tokens.test.js` |
| Owner wording: no staff codes, confidence in words, no trend the readings do not show | `packages/core/src/owner.test.js` |
| No all-caps label (`uppercase` class or `textTransform`) on the web or the phone | `frontend/src/test/label-voice.test.js`, `mobile/src/test/label-voice.test.ts` |
| Icons, splash and favicons exist at the sizes asked for, in token colours, at 3:1+ | `mobile/src/test/brand.test.ts`, `frontend/src/test/brand.test.js` |
| The console's tabs stay one line at 1024 and 1280 px, and every tab is in view | `frontend/e2e/baseline.spec.js` |
| Every screen matches the reviewed screenshots | `frontend/e2e/baseline.spec.js` |

## Night mode

The head unit has a night toggle; the owner's phone (`/app`) follows the device's light/dark
setting. Two routes, one set of tokens: inline-styled owner components read `useNight()` (a
context, `frontend/src/night.jsx`) and call `tokens(night)`; Tailwind-built screens (sign-in) flip
through `data-theme="night"` on `<html>`, which `tokens.css` answers. The console and its preview of
the phone stay light.

## Components

* **`Dialog`** (`ui.jsx`) — every modal. Named by its title, `aria-modal`, Escape and click-outside
  close it, focus moves in and returns to the opener, Tab is kept inside, rendered in a portal on
  `<body>` (inside a page, the entrance animation's stacking context put it under the header).
* **`SectionNav`** / **`AccountMenu`** (`App.jsx`) — `aria-current="page"` on the current section;
  the account menu is a disclosure (`aria-expanded`, `aria-controls`, Escape, click outside).
* **`StatStrip`** (`ui.jsx`) — a page's headline figures: one `<dl>`, figures divided by a line,
  two columns on a phone. `bare` drops the frame for figures inside a card.
* **`BrandMark`** (`ui.jsx`) — the mark on its accent tile, beside the wordmark in the console
  header and on both sign-in pages; `aria-hidden`, since the wordmark already names the product.
* The **`SectionNav`** highlight is re-measured whenever the row reflows (`ResizeObserver`): it was
  measured once, before the web font loaded, and sat 5 px short of its tab in every screenshot.
* Keyboard focus: one global `:focus-visible` ring in `accentDeep` (4.2:1 on the page). A box that
  scrolls (the tab row) keeps 4 px of padding so the ring is not clipped.

## What Phase 2 changed, reviewed screen by screen

| Change | Notes |
|---|---|
| Pages moved to semantic names; legacy names deleted | pixel-identical, then guarded |
| Owner-kit greys merged with the console's | merged toward the **darker** `#5e646d` — the lighter one failed 4.5:1 on the head unit's chrome (a token test caught the original plan) |
| Font sizes snapped: 27 → 10 steps (`hero` 38 added for the one big number) | |
| ~25 one-off colours → tokens (`positive`, `okBg`, `alertBg`, `control`, `chrome`, `bezel`, `hatchGround`, `icon`, `marker`, `link`, `onAccent`, device ring) | |
| Status green `#1f9d55` → `positive` `#15703a` | was 3.5:1 for 11px text |
| White-on-orange buttons → `accentDeep` | head unit Book, owner Send, chat bubbles |
| Orange text → `accentInk` (day) / `link` (night) | was 2.9:1 |
| Radii | left on Tailwind's own scale in the console; the owner kit keeps its values — snapping them was churn with no user-visible gain, so it was not done |
