// @vitest-environment node
/**
 * The public site keeps its own, larger type scale (it is a reading page, not a
 * data screen), but it is still one scale. Before this guard site.css used 28
 * different sizes — 12 and 12.5, 13 and 13.5, 14 and 14.5 side by side — which
 * reads as noise, not hierarchy. Every font-size in it must now be a step
 * defined once on `.site`, and the two "mini" steps may only be used for text
 * drawn inside the device mock-ups (and the tick/cross glyphs in the lists).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "src", "site", "site.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

const DEFINED = new Set([...CSS.matchAll(/(--fs-[a-z0-9-]+)\s*:/g)].map((m) => m[1]));

const rules = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
const sizes = rules.flatMap(({ selector, body }) =>
  [...body.matchAll(/(?<![\w-])font-size\s*:\s*([^;]+)/g)].map((m) => ({ selector, value: m[1].trim() })));

describe("site type scale", () => {
  it("defines its steps once", () => {
    expect([...DEFINED].sort()).toEqual([
      "--fs-body", "--fs-h1", "--fs-h2", "--fs-h3", "--fs-label", "--fs-lead",
      "--fs-mini", "--fs-mini-2", "--fs-small", "--fs-stat", "--fs-stat-xl", "--fs-title",
    ]);
  });

  it("sets every font-size from a step, never a raw value", () => {
    expect(sizes.length).toBeGreaterThan(50);
    const raw = sizes.filter(({ value }) => !/^var\(--fs-[a-z0-9-]+\)$/.test(value));
    expect(raw).toEqual([]);
  });

  it("uses only steps that exist", () => {
    const unknown = sizes
      .map(({ value }) => value.match(/var\((--fs-[a-z0-9-]+)\)/)?.[1])
      .filter((name) => name && !DEFINED.has(name));
    expect(unknown).toEqual([]);
  });

  it("keeps the mini steps inside the device mock-ups", () => {
    const misused = sizes.filter(({ selector, value }) =>
      /--fs-mini/.test(value) && !/s-mini|s-phone-status|s-agent-lists/.test(selector));
    expect(misused).toEqual([]);
  });
});
