// @vitest-environment node
/**
 * Components take colours from @autosaarthi/tokens. A hex literal in a
 * component is a colour with no night value, no contrast check, and no way
 * to reach the mobile app — so none are allowed outside tests.
 * Shadows (rgba black) are not colours in that sense and stay as they are.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const HEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.jsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

// The deck's orange is 2.9:1 on the page — it fails even the 3:1 large-text
// allowance. It fills, outlines and draws icons; text in that hue uses
// accent-ink (5.2:1).
const ACCENT_TEXT = /(?:^|[\s"'`:])text-accent(?:\/\d+)?(?=[\s"'`]|$)|color:\s*ACCENT\b/;

describe("brand orange as text", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))("not in %s", (rel) => {
    const hits = readFileSync(join(SRC, rel), "utf8").split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => ACCENT_TEXT.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});

describe("hard-coded colours", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))("none in %s", (rel) => {
    const hits = readFileSync(join(SRC, rel), "utf8").split("\n")
      .map((line, i) => [i + 1, line.replace(/\/\/.*$/, "")])
      .filter(([, line]) => HEX.test(line))
      .map(([n, line]) => `${n}: ${line.trim()}`);
    expect(hits).toEqual([]);
  });
});
