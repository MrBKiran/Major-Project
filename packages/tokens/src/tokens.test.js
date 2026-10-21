import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderCss } from "../scripts/build-css.js";
import { chart, color, contrast, day, mix, night, radius, space, text } from "./index.js";

describe("modes", () => {
  it("define the same tokens by day and by night", () => {
    // The phone follows the system theme and the head unit switches at dusk:
    // a token missing from one mode is a blank colour on someone's screen.
    expect(Object.keys(night).sort()).toEqual(Object.keys(day).sort());
  });

  it("are all six-digit hex, so every platform can parse them", () => {
    for (const value of [...Object.values(day), ...Object.values(night), ...Object.values(color)]) {
      expect(value).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

// Every text step carries 11–13px copy somewhere, so all of them owe 4.5:1.
const TEXT = ["fgStrong", "fg", "fgSecondary", "fgTertiary", "fgMuted", "fgSubtle"];
const SURFACES = ["page", "panel", "card"];

describe.each([["day", day], ["night", night]])("%s contrast", (_, mode) => {
  for (const fg of TEXT) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg} clears 4.5:1`, () => {
        expect(contrast(mode[fg], mode[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("pill ink clears 4.5:1 on its pill", () => {
    expect(contrast(mode.pillInk, mode.pillBg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mode.amberInk, mode.amberBg)).toBeGreaterThanOrEqual(4.5);
  });

  // "Healthy · agent watching" and "Confirmed" are 11px. In #1f9d55 they were
  // 3.5:1 on white — the colour of the brand, not of legible small text.
  it.each(["page", "panel", "card", "okBg"])("positive text clears 4.5:1 on %s", (bg) => {
    expect(contrast(mode.positive, mode[bg])).toBeGreaterThanOrEqual(4.5);
  });

  // WCAG 2.2 SC 1.4.11: a text field is found by its outline, and `border`
  // (1.2–1.4:1) is a divider, too faint to be a field's only edge.
  it.each(["page", "panel", "card", "inset"])("a control's outline clears 3:1 on %s", (bg) => {
    expect(contrast(mode.borderStrong, mode[bg])).toBeGreaterThanOrEqual(3);
  });

  it("the driving alert band keeps its text legible", () => {
    expect(contrast(mode.fg, mode.alertBg)).toBeGreaterThanOrEqual(4.5);
  });

  it("status bar and dock text clear 4.5:1 on the chrome", () => {
    expect(contrast(mode.fgMuted, mode.chrome)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mode.fgSubtle, mode.chrome)).toBeGreaterThanOrEqual(4.5);
  });

  it("map labels clear 4.5:1 on the hatched ground and its stripes", () => {
    expect(contrast(mode.fgSubtle, mode.hatchGround)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(mode.fgSubtle, mode.hatch)).toBeGreaterThanOrEqual(4.5);
  });

  // Seen on the phone at night: the owner's "All service history" link in
  // accentInk was dark red on near-black, about 3.2:1.
  it.each(["page", "panel", "card"])("link text clears 4.5:1 on %s", (bg) => {
    expect(contrast(mode.link, mode[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("button text clears 4.5:1 on a neutral control", () => {
    expect(contrast(mode.fg, mode.control)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("text on the brand colour", () => {
  // White on the deck's orange is 3.4:1. WCAG lets large text (24px, or ~18.7px
  // bold) off with 3:1; the chat bubbles, Send and the head unit's Book button
  // are 13.5–17px — so white text sits on accentDeep, everywhere.
  it("white on accentDeep clears 4.5:1", () => {
    expect(contrast(color.onAccent, color.accentDeep)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(["page", "panel", "card"])("orange text (accentInk) clears 4.5:1 on %s", (bg) => {
    expect(contrast(color.accentInk, day[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it("the plain accent as text would not — 2.9:1 on the page", () => {
    expect(contrast(color.accent, day.page)).toBeLessThan(3);
  });

  it("white on the plain accent would not, which is why it is not used for text", () => {
    expect(contrast(color.onAccent, color.accent)).toBeLessThan(4.5);
  });
});

describe("badge ink on its own 10% tint over a card", () => {
  for (const tone of ["p1", "p2", "p3", "ok", "accent"]) {
    it(`${tone} clears 4.5:1`, () => {
      const tint = mix(color[tone], day.card, 0.1);
      expect(contrast(color[`${tone}Ink`], tint)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("scales", () => {
  it("type steps grow monotonically", () => {
    const sizes = Object.values(text).map((t) => t.size);
    expect(sizes).toEqual([...sizes].sort((a, b) => a - b));
    expect(new Set(sizes).size).toBe(sizes.length);
  });

  it("has far fewer type steps than the 27 sizes in use before", () => {
    expect(Object.keys(text).length).toBeLessThanOrEqual(10);
  });

  it("spacing is a 4-point scale, growing", () => {
    const steps = Object.values(space);
    for (const v of steps) expect(v % 4).toBe(0);
    expect(steps).toEqual([...steps].sort((a, b) => a - b));
    expect(new Set(steps).size).toBe(steps.length);
  });

  it("radii grow monotonically", () => {
    const r = Object.values(radius);
    expect(r).toEqual([...r].sort((a, b) => a - b));
  });

  it("chart series are distinct", () => {
    const series = [chart.baseline, chart.predicted, chart.capacity, chart.volt];
    expect(new Set(series).size).toBe(series.length);
  });
});

describe("tokens.css", () => {
  const css = renderCss();

  it("is the generated file, not a hand edit", () => {
    const committed = readFileSync(new URL("../tokens.css", import.meta.url), "utf8");
    expect(committed).toBe(css);
  });

  // Phase 1 kept ink-*, slate-* and edge so the token source could land without
  // a pixel changing; Phase 2 moved every page to the semantic names and
  // retired them. slate-* in particular was Tailwind's own scale inverted —
  // a trap for anyone who knows Tailwind.
  it("no longer defines the retired legacy names", () => {
    expect(css).not.toMatch(/--color-(ink|slate)-\d00:/);
    expect(css).not.toMatch(/--color-edge:/);
  });

  it.each([
    ["--color-surface-page", "#eceef1"], ["--color-surface-card", "#ffffff"],
    ["--color-fg-muted", "#4e5560"], ["--color-border", "#d7dade"],
    ["--color-p1-ink", "#b32f13"], ["--color-accent-deep", "#d13c14"],
  ])("keeps %s at %s", (name, value) => {
    expect(css).toContain(`${name}: ${value};`);
  });

  it("exposes the semantic names, with night overrides", () => {
    expect(css).toContain("--color-surface-page: #eceef1;");
    expect(css).toContain("--color-fg: #16181d;");
    expect(css).toMatch(/\[data-theme="night"\][^}]*--color-surface-page: #0d0f12;/s);
  });

  it("adds the type and radius scales without overriding Tailwind's own names", () => {
    expect(css).toContain("--text-body: 14px;");
    expect(css).not.toMatch(/--text-(xs|sm|base|lg|xl):/);
    expect(css).not.toMatch(/--radius-(xs|sm|md|lg|xl):/);
  });

  it("gives controls their stronger outline, by day and night", () => {
    expect(css).toContain(`--color-border-strong: ${day.borderStrong};`);
    expect(css).toContain(`--color-border-strong: ${night.borderStrong};`);
  });

  it("leaves spacing to Tailwind's own 4px scale on the web", () => {
    // Tailwind's --spacing is already 0.25rem; the space tokens are for the
    // phone and the head unit, which have no Tailwind.
    expect(css).not.toMatch(/--spacing/);
  });
});
