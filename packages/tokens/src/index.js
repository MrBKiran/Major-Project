/**
 * AutoSaarthi design tokens — the one source for the web console, the owner
 * web app, the head unit, the React Native app and (as generated Android
 * resources) the Android Auto screens.
 *
 * Plain JavaScript on purpose: Vite, Node and Metro all read it with no build
 * step. The web gets it as CSS custom properties from tokens.css, which
 * scripts/build-css.js generates from this file — edit here, then run
 * `npm run tokens` at the repo root.
 *
 * Every token exists by day and by night. Phones follow the system theme and
 * the head unit switches at dusk; a token with no night value is a white
 * panel thrown at a driver at 21:34.
 */

/** Mode-independent: brand, severity, and the inks that sit on their tints. */
export const color = {
  accent: "#ff4a23",          // the deck's CTA orange
  accentDeep: "#d13c14",      // white small text on accent needs this depth (4.5:1)
  accentInk: "#b8320f",
  p1: "#d8391a",
  p1Ink: "#b32f13",
  p2: "#b26a00",
  p2Ink: "#8a5200",
  p3: "#0b7fc4",
  p3Ink: "#0a6394",
  ok: "#1f9d55",
  okInk: "#15703a",
  amber: "#e8a33d",
  onAccent: "#ffffff",        // text on accentDeep — never on plain accent (3.4:1)
  // The head unit's physical bezel: hardware, not theme, so the same by day and night.
  deviceRing: "#16181d",
  deviceRingEdge: "#2a2e34",
};

export const day = {
  page: "#eceef1",
  panel: "#f6f7f8",
  card: "#ffffff",
  inset: "#f3f4f6",
  insetStrong: "#e4e7ea",
  border: "#d7dade",
  // A control's own edge — text fields, selected options. `border` is a
  // divider at ~1.3:1; a field found only by its outline needs 3:1 (WCAG 1.4.11).
  borderStrong: "#828891",
  hatch: "#dfe2e6",

  // Text, most to least prominent. Each step clears 4.5:1 on page, panel and card.
  fgStrong: "#0f1115",
  fg: "#16181d",
  fgSecondary: "#2f343c",
  fgTertiary: "#3c424b",
  fgMuted: "#4e5560",
  fgSubtle: "#5e646d",       // the head unit's darker step: it must also clear 4.5:1 on its chrome
  fgDecorative: "#a8aeb6",    // fills only, never text

  pillBg: "#ffe1dc",
  pillInk: "#b32f13",
  amberBg: "#fdf0d9",
  amberInk: "#8a5200",

  // Status text that means "fine": the brand green is 3.5:1 on white, too
  // faint for the 11px labels it carries.
  positive: "#15703a",
  okBg: "#eaf7ee",
  okBorder: "#cfe8d8",
  alertBg: "#fdeae5",         // the driving-mode alert band
  control: "#eef0f2",         // neutral button fill: hover, disabled
  chrome: "#e4e7ea",          // head unit status bar and dock
  bezel: "#c9ced4",
  hatchGround: "#e6e9ec",     // under the hatch that stands in for map tiles
  icon: "#9aa1ab",            // decorative strokes
  marker: "#7ab8e8",          // "you are here"
  link: "#b8320f",            // orange text: accentInk by day
};

export const night = {
  page: "#0d0f12",
  panel: "#14171c",
  card: "#191d23",
  inset: "#1f242b",
  insetStrong: "#262b33",
  border: "#272c33",
  borderStrong: "#69707a",
  hatch: "#1a1e24",

  fgStrong: "#f3f4f6",
  fg: "#e8eaed",
  fgSecondary: "#d0d4da",
  fgTertiary: "#bfc4cb",
  fgMuted: "#a7aeb8",
  fgSubtle: "#959ca6",
  fgDecorative: "#4a5059",

  pillBg: "#3a1a12",
  pillInk: "#ff8060",
  amberBg: "#3a2c12",
  amberInk: "#e8a33d",

  positive: "#1f9d55",
  okBg: "#12251a",
  okBorder: "#1f3a29",
  alertBg: "#241512",
  control: "#1c2026",
  chrome: "#0a0c0f",
  bezel: "#000000",
  hatchGround: "#101317",
  icon: "#7a828c",
  marker: "#5aa9e6",
  link: "#ff8060",            // accentInk is ~3.2:1 on the night page
};

export function mode(night_) {
  return night_ ? night : day;
}

/** Recharts and native charts take literal colours, so the series live here too. */
export const chart = {
  grid: "#e4e7ea",
  axis: "#9aa1ab",
  temp: "#e07a00",
  volt: "#1f9d55",
  baseline: "#2563eb",
  predicted: "#e07a00",
  capacity: "#d8391a",
};

export const font = {
  sans: "'Space Grotesk', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'Cascadia Code', Consolas, monospace",
};

/** Ten steps, replacing 27 sizes in use before. Line heights are unitless. */
export const text = {
  caption: { size: 11, lineHeight: 1.45 },
  label: { size: 12, lineHeight: 1.45 },
  bodySm: { size: 13, lineHeight: 1.5 },
  body: { size: 14, lineHeight: 1.5 },
  lead: { size: 15, lineHeight: 1.5 },
  titleSm: { size: 17, lineHeight: 1.35 },
  title: { size: 21, lineHeight: 1.25 },
  display: { size: 27, lineHeight: 1.15 },
  displayLg: { size: 31, lineHeight: 1.1 },
  hero: { size: 38, lineHeight: 1.05 },     // the one big number on a screen
};

/** A 4-point spacing scale for the phone and the head unit. The web console
 *  uses Tailwind's, which is the same 4px step. */
export const space = {
  0: 0, 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48,
};

export const radius = {
  chip: 6,
  control: 10,
  card: 12,
  panel: 16,
  pill: 999,
};

// ── colour maths, shared by the tests and anything that has to check contrast

function channels(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two hex colours. */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `top` laid over `base` at `alpha`, as a hex colour — what a 10% tint renders as. */
export function mix(top, base, alpha) {
  const t = channels(top);
  const b = channels(base);
  const out = t.map((v, i) => Math.round(v * alpha + b[i] * (1 - alpha)));
  return `#${out.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
