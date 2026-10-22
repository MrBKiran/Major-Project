/**
 * The app's icon, splash and favicon are rendered from one source
 * (design/brand/road.svg, by design/brand/render.mjs). These checks keep
 * app.json pointing at those renders, at the sizes Android asks for, in the
 * token colours — so a hand-picked hex or a leftover template image fails here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { color, contrast, day, night } from '@autosaarthi/tokens';

const ROOT = join(__dirname, '..', '..');
const expo = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8')).expo;
const splash = expo.plugins.find((p: unknown) => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
const adaptive = expo.android.adaptiveIcon;

/** Width and height from a PNG's IHDR chunk. */
function size(rel: string): [number, number] {
  const b = readFileSync(join(ROOT, rel));
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

describe('brand assets', () => {
  const images: string[] = [
    expo.icon, expo.web.favicon, splash.image, splash.dark.image,
    adaptive.foregroundImage, adaptive.monochromeImage,
  ];

  it.each(images.map((p) => [p]))('%s exists', (p) => {
    expect(existsSync(join(ROOT, p))).toBe(true);
  });

  it('has a 1024 px square app icon and a 48 px favicon', () => {
    expect(size(expo.icon)).toEqual([1024, 1024]);
    expect(size(expo.web.favicon)).toEqual([48, 48]);
  });

  it('draws both adaptive icon layers square, at least 512 px, at the same size', () => {
    const [w, h] = size(adaptive.foregroundImage);
    expect(w).toBe(h);
    expect(w).toBeGreaterThanOrEqual(512); // Expo's minimum for adaptive icons
    expect(size(adaptive.monochromeImage)).toEqual([w, h]);
  });

  it('puts the adaptive icon on the brand accent, as a colour rather than an image', () => {
    expect(same(adaptive.backgroundColor, color.accent)).toBe(true);
    expect(adaptive.backgroundImage).toBeUndefined();
  });

  it('opens on the page colour of each mode, with a mark drawn for that mode', () => {
    expect(same(splash.backgroundColor, day.page)).toBe(true);
    expect(same(splash.dark.backgroundColor, night.page)).toBe(true);
    expect(splash.dark.image).not.toBe(splash.image);
  });

  // The mark is a graphic, so its bar is 3:1 (WCAG 1.4.11), not text's 4.5:1.
  it('keeps the mark at 3:1 or better wherever it is drawn', () => {
    expect(contrast(color.onAccent, color.accent)).toBeGreaterThanOrEqual(3);  // icon glyph on its tile
    expect(contrast(color.accentDeep, day.page)).toBeGreaterThanOrEqual(3);   // day splash
    expect(contrast(color.accent, night.page)).toBeGreaterThanOrEqual(3);     // night splash
  });
});
