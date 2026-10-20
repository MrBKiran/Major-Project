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
4. **New code uses semantic names** (`surface-*`, `fg-*`, `border`). The legacy `ink-*` / `slate-*`
   names exist only so the token source could land without changing a pixel.
5. **Times are IST**, built by `formatSlot` / `formatDate` — never `toLocaleString`.

## Tokens

**Surfaces:** `page` `panel` `card` `inset` `insetStrong` · `border` · `hatch`.
**Text, most to least prominent:** `fgStrong` `fg` `fgSecondary` `fgTertiary` `fgMuted`
`fgSubtle` (+ `fgDecorative`, fills only). **Brand / severity:** `accent` `accentDeep`, `p1` `p2`
`p3` `ok` and their `*Ink` variants. **Charts:** `grid` `axis` `baseline` `predicted` `capacity`
`temp` `volt`.

**Type — ten steps** (was 27 sizes): `caption` 11 · `label` 12 · `bodySm` 13 · `body` 14 ·
`lead` 15 · `titleSm` 17 · `title` 21 · `display` 27 · `displayLg` 31 · `hero` 38 — Tailwind `text-caption` …

**Radius:** `chip` 6 · `control` 10 · `card` 12 · `panel` 16 · `pill` 999 — `rounded-card` …

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
* Keyboard focus: one global `:focus-visible` ring in `accentDeep` (4.2:1 on the page).

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
