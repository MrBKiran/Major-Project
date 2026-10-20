import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderCss } from "../scripts/build-css.js";
import { chart, color, contrast, day, mix, night, radius, text } from "./index.js";

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
const TEXT = ["fgStrong", "fg", "fgSecondary", "fgTertiary", "fgMuted", "fgSubtle", "fgDevice", "fgDeviceFaint"];
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

  // The Tailwind names the pages use today must keep today's values: the token
  // source arrives without changing a pixel, and merging lands later, reviewed.
  it.each([
    ["--color-ink-900", "#eceef1"], ["--color-ink-800", "#ffffff"], ["--color-ink-700", "#f3f4f6"],
    ["--color-ink-600", "#e4e7ea"], ["--color-edge", "#d7dade"],
    ["--color-slate-100", "#0f1115"], ["--color-slate-200", "#16181d"], ["--color-slate-300", "#2f343c"],
    ["--color-slate-400", "#3c424b"], ["--color-slate-500", "#4e5560"], ["--color-slate-600", "#646a74"],
    ["--color-slate-700", "#a8aeb6"],
    ["--color-p1", "#d8391a"], ["--color-p2", "#b26a00"], ["--color-p3", "#0b7fc4"], ["--color-ok", "#1f9d55"],
    ["--color-accent", "#ff4a23"], ["--color-accent-deep", "#d13c14"],
    ["--color-p1-ink", "#b32f13"], ["--color-p2-ink", "#8a5200"], ["--color-p3-ink", "#0a6394"],
    ["--color-ok-ink", "#15703a"], ["--color-accent-ink", "#b8320f"],
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
});
