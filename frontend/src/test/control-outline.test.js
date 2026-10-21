// @vitest-environment node
/**
 * WCAG 2.2 SC 1.4.11: a text field or a select is found by its outline, which
 * must clear 3:1. `border` is a divider at about 1.3:1, so a field drawn with
 * it is barely there — the design critique found every one of them like that.
 * Fields use `border-border-strong`, the shared `inputCls`, or — in the device
 * kit's inline styles — `edgeStrong`.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.jsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

/** Each <input>, <select> or <textarea> element's opening tag, with its line. */
function controls(source) {
  const out = [];
  // Up to the tag's own `>` — not the `=>` of an onChange arrow inside it.
  const re = /<(input|select|textarea)\b[\s\S]*?(?<!=)>/g;
  for (let m; (m = re.exec(source));) {
    out.push({ tag: m[0], line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

describe("form controls", () => {
  it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))("are outlined strongly enough in %s", (rel) => {
    const weak = controls(readFileSync(join(SRC, rel), "utf8"))
      .filter(({ tag }) => /type="(checkbox|radio|hidden|file)"/.test(tag) === false)
      .filter(({ tag }) => !/border-border-strong|inputCls|edgeStrong/.test(tag))
      .map(({ tag, line }) => `${line}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    expect(weak).toEqual([]);
  });
});
