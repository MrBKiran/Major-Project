// @vitest-environment node
/**
 * The retired colour names (ink-*, slate-*, edge) must not come back: slate-*
 * was Tailwind's own scale with its direction inverted, so a new page written
 * the way Tailwind documents it would render near-black where it meant pale.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src") + "/";
const RETIRED = /\b(?:text|bg|border(?:-[trblxy])?|ring|divide|fill|stroke|outline|placeholder|from|to|via|decoration)-(?:slate-[1-9]00|ink-[1-9]00|edge)\b|--color-(?:slate|ink)-\d00|--color-edge\b/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(jsx?|css)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("retired colour names", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length)]))("are not used in %s", (rel) => {
    const lines = readFileSync(join(SRC, rel), "utf8").split("\n");
    const hits = lines.map((l, i) => (RETIRED.test(l) ? `${i + 1}: ${l.trim()}` : null)).filter(Boolean);
    expect(hits).toEqual([]);
  });
});
