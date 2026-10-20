// @vitest-environment node
/**
 * Every font size is a step on the shared type scale (packages/tokens). The
 * audit counted 27 different sizes before this — 12.5, 13.5, 14.5, 15.5 sitting
 * next to 12, 13, 14, 15 — which is noise, not hierarchy.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { text } from "@autosaarthi/tokens";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const STEPS = new Set(Object.values(text).map((t) => t.size));

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.jsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function offScale(source) {
  const found = [];
  source.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/fontSize:\s*([0-9.]+)|\bsize=\{([0-9.]+)\}/g)) {
      const px = Number(m[1] ?? m[2]);
      if (!STEPS.has(px)) found.push(`${i + 1}: ${px}px`);
    }
    for (const m of line.matchAll(/\btext-\[([0-9.]+)px\]/g)) found.push(`${i + 1}: text-[${m[1]}px]`);
    for (const m of line.matchAll(/(?<![\w-])text-(xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g)) {
      found.push(`${i + 1}: text-${m[1]} (Tailwind's scale, not ours)`);
    }
  });
  return found;
}

describe("type scale", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))("%s uses only its steps", (rel) => {
    expect(offScale(readFileSync(join(SRC, rel), "utf8"))).toEqual([]);
  });
});
