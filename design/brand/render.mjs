/**
 * Renders the AutoSaarthi mark (road.svg) into every icon the apps ship: the
 * phone's app icon, Android adaptive layers, splash marks and favicon, and the
 * web console's favicons. Colours come from the tokens package; proportions are
 * the ones reviewed on the brand sheet. Re-run after changing road.svg:
 *
 *   node design/brand/render.mjs
 *
 * Uses the web app's Playwright with Microsoft Edge, as the visual baseline does.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { color } from "../../packages/tokens/src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const { chromium } = createRequire(join(root, "frontend", "package.json"))("@playwright/test");

const mark = readFileSync(join(here, "road.svg"), "utf8");
// The drawing alone — no <svg> wrapper, no comment — for placing inside a tile.
const drawing = mark
  .replace(/^[\s\S]*?<svg[^>]*>/, "")
  .replace(/<\/svg>\s*$/, "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .trim();

// A graphic, not text: white on the plain accent is 3.4:1, over the 3:1 a
// graphic needs (WCAG 1.4.11). Text on the accent would need accentDeep.
const GLYPH = color.onAccent;
const TILE = 0.76;            // the mark's 1024-unit box, as a share of a square tile
const ADAPTIVE = 0.62 * 72 / 108; // same look inside the 72 dp a launcher shows of the 108 dp canvas
const ROUND = 0.23;           // corner radius of a rounded tile, as a share of its side

const mobile = join(root, "mobile", "assets", "images");
const web = join(root, "frontend", "public");

const renders = [
  // The OS masks the app icon itself: full-bleed, no corners (Expo: 1024 px, square, opaque).
  { out: join(mobile, "icon.png"), px: 1024, bg: color.accent, ink: GLYPH, box: TILE },
  // Adaptive layers on a transparent canvas; the background is a colour in app.json.
  { out: join(mobile, "android-icon-foreground.png"), px: 1024, ink: GLYPH, box: ADAPTIVE },
  // Themed (Android 13+): only the alpha is used, the launcher tints it.
  { out: join(mobile, "android-icon-monochrome.png"), px: 1024, ink: GLYPH, box: ADAPTIVE },
  // Splash marks, one per mode, each at 3:1+ on that mode's page colour.
  { out: join(mobile, "splash-icon.png"), px: 1024, ink: color.accentDeep, box: 1 },
  { out: join(mobile, "splash-icon-dark.png"), px: 1024, ink: color.accent, box: 1 },
  { out: join(mobile, "favicon.png"), px: 48, bg: color.accent, ink: GLYPH, box: TILE, round: ROUND },
  { out: join(web, "favicon-48.png"), px: 48, bg: color.accent, ink: GLYPH, box: TILE, round: ROUND },
  // iOS rounds the home-screen icon itself.
  { out: join(web, "apple-touch-icon.png"), px: 180, bg: color.accent, ink: GLYPH, box: TILE },
];

function page({ px, bg, ink, box, round = 0 }) {
  return `<!doctype html><meta charset="utf-8"><style>
    html, body { margin: 0; background: transparent; }
    .tile { width: ${px}px; height: ${px}px; display: grid; place-items: center;
            background: ${bg ?? "transparent"}; border-radius: ${round * px}px; color: ${ink}; }
    .box { width: ${box * px}px; height: ${box * px}px; }
    .box svg { display: block; width: 100%; height: 100%; }
  </style><div class="tile"><div class="box">${mark}</div></div>`;
}

/** The browser-tab icon as SVG: the same drawing on a rounded accent tile. */
function faviconSvg() {
  const inset = (1024 * (1 - TILE)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <!-- Rendered from design/brand/road.svg by design/brand/render.mjs: edit those, not this. -->
  <rect width="1024" height="1024" rx="${Math.round(1024 * ROUND)}" fill="${color.accent}"/>
  <g transform="translate(${inset} ${inset}) scale(${TILE})">
    ${drawing.replaceAll("currentColor", GLYPH)}
  </g>
</svg>
`;
}

const browser = await chromium.launch({ channel: "msedge" });
try {
  for (const r of renders) {
    const tab = await browser.newPage({ viewport: { width: r.px, height: r.px }, deviceScaleFactor: 1 });
    await tab.setContent(page(r));
    await tab.screenshot({ path: r.out, omitBackground: true, clip: { x: 0, y: 0, width: r.px, height: r.px } });
    await tab.close();
    console.log(`${r.px}px  ${r.out.slice(root.length + 1)}`);
  }
} finally {
  await browser.close();
}
writeFileSync(join(web, "favicon.svg"), faviconSvg());
console.log("svg    frontend/public/favicon.svg");
