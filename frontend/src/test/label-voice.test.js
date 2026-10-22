// @vitest-environment node
/**
 * Labels are sentence case, in the text face. Every panel carried an ALL-CAPS,
 * tracked-out label ("FLEET", "MODEL CONFIDENCE"), so nothing stood out and the
 * product read as a template. Monospace stays for data — VINs, codes, amounts —
 * where the fixed width helps; capitals are not used to make a label a label.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const SHOUTING = /(?:^|[\s"'`])uppercase(?=[\s"'`]|$)|textTransform:\s*["']uppercase["']/;

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.jsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("labels", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))("are sentence case in %s", (rel) => {
    const hits = readFileSync(join(SRC, rel), "utf8").split("\n")
      .map((line, i) => [i + 1, line])
      .filter(([, line]) => SHOUTING.test(line))
      .map(([n, line]) => `${n}: ${line.trim().slice(0, 110)}`);
    expect(hits).toEqual([]);
  });
});
