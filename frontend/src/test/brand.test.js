// @vitest-environment node
/**
 * The tab icon and the home-screen icon come from the same mark as the phone
 * app (design/brand/road.svg, rendered by design/brand/render.mjs).
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(join(process.cwd(), "index.html"), "utf8");
const pub = (p) => join(process.cwd(), "public", p);

describe("brand icons", () => {
  it.each([
    ['rel="icon" type="image/svg+xml" href="/favicon.svg"', "favicon.svg"],
    ['rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png"', "favicon-48.png"],
    ['rel="apple-touch-icon" href="/apple-touch-icon.png"', "apple-touch-icon.png"],
  ])("index.html links %s and the file exists", (link, file) => {
    expect(html).toContain(link);
    expect(existsSync(pub(file))).toBe(true);
  });

  it("draws the header mark from the same source", () => {
    const ui = readFileSync(join(process.cwd(), "src", "ui.jsx"), "utf8");
    const mark = readFileSync(join(process.cwd(), "..", "design", "brand", "road.svg"), "utf8");
    expect(ui).toContain(mark.match(/<path d="([^"]+)"/)[1]);
  });

  it("draws the favicon from the mark's own path, on the accent", () => {
    const svg = readFileSync(pub("favicon.svg"), "utf8");
    const mark = readFileSync(join(process.cwd(), "..", "design", "brand", "road.svg"), "utf8");
    const road = mark.match(/<path d="([^"]+)"/)[1];
    expect(svg).toContain(road);
    expect(svg.toLowerCase()).toContain("#ff4a23");
  });
});
