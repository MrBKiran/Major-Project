/**
 * Pure helpers for with-windows-cmake.js, kept apart so they can be tested
 * without a prebuild.
 */

const MIN = [3, 31];

/** @param {string} v */
function parse(v) {
  const m = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

/** @param {number[]} a @param {number[]} b */
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * The newest installed CMake at or above 3.31, or null.
 * @param {string[]} versions folder names under <sdk>/cmake
 * @returns {string | null}
 */
function pickCmake(versions) {
  let best = null;
  let bestParts = null;
  for (const v of versions) {
    const parts = parse(v);
    if (!parts || compare(parts, MIN) < 0) continue;
    if (!bestParts || compare(parts, bestParts) > 0) {
      best = v;
      bestParts = parts;
    }
  }
  return best;
}

/**
 * Sets `entries` in a local.properties text, keeping every other line;
 * paths are written with forward slashes.
 * @param {string} text
 * @param {Record<string, string>} entries
 * @returns {string}
 */
function mergeProperties(text, entries) {
  const lines = text ? text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n') : [];
  const pending = new Map(Object.entries(entries).map(([k, v]) => [k, v.replace(/\\/g, '/')]));
  const out = lines.map((line) => {
    const key = line.split('=')[0].trim();
    if (!line.trimStart().startsWith('#') && pending.has(key)) {
      const value = pending.get(key);
      pending.delete(key);
      return `${key}=${value}`;
    }
    return line;
  });
  for (const [k, v] of pending) out.push(`${k}=${v}`);
  return out.join('\n') + '\n';
}

module.exports = { pickCmake, mergeProperties };
