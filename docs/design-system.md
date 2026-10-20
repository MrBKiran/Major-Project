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

**Type — nine steps** (was 27 sizes): `caption` 11 · `label` 12 · `bodySm` 13 · `body` 14 ·
`lead` 15 · `titleSm` 17 · `title` 21 · `display` 27 · `displayLg` 31 — Tailwind `text-caption` …

**Radius:** `chip` 6 · `control` 10 · `card` 12 · `panel` 16 · `pill` 999 — `rounded-card` …

## Phase 2: the reviewed changes

Phase 1 changed no pixel on purpose (proven against the baseline). These do change pixels, so each
lands in Phase 2 with its screenshot diff reviewed:

| Change | From → to |
|---|---|
| Merge the owner kit's text greys into the console's | `fgDevice` #474d56 → `fgMuted` #4e5560 · `fgDeviceFaint` #5e646d → `fgSubtle` #646a74 |
| Snap font sizes to the scale | 9.5 / 10 / 10.5 → 11 · 12.5 → 12 · 13.5 → 13 · 14.5 → 14 · 15.5 → 15 · 19 / 20 / 22 → 21 · 26 → 27 · 38 (clock) stays a one-off |
| Snap radii | 2 / 4 / 5 → `chip` · 8 / 10 → `control` · 14 → `card` or `panel` · 18 → `panel` |
| Replace ~25 one-off hex values in `device.jsx` / `OwnerApp.jsx` / `InCarConsole.jsx` | hatch grounds, button fills, bezel greys → tokens (new tokens only where nothing fits) |
| Move pages off `ink-*` / `slate-*` | then delete the legacy names from `build-css.js` |
| Night mode for the owner web app | `data-theme="night"` already flips every semantic token |
