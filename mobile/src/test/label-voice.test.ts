/**
 * Labels are sentence case, in the text face — the same rule as the web
 * (frontend/src/test/label-voice.test.js). Monospace stays for data.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..');
const SHOUTING = /textTransform:\s*['"]uppercase['"]/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx?$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

it.each(files(SRC).map((f) => [f.slice(SRC.length + 1)]))('labels are sentence case in %s', (rel) => {
  const hits = readFileSync(join(SRC, rel), 'utf8').split('\n')
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => SHOUTING.test(line))
    .map(([n, line]) => `${n}: ${line.trim().slice(0, 110)}`);
  expect(hits).toEqual([]);
});
