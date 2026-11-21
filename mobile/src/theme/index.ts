/**
 * The app's look, from the same tokens as the web console, the owner web app
 * and the head unit (packages/tokens). Night values are the phone's dark mode.
 */

import { color, day, night, radius, space, text } from '@autosaarthi/tokens';
import { useColorScheme } from 'react-native';

export { space };

export const fonts = {
  regular: 'SpaceGrotesk_400Regular',
  medium: 'SpaceGrotesk_500Medium',
  semibold: 'SpaceGrotesk_600SemiBold',
  bold: 'SpaceGrotesk_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
} as const;

export type Step = keyof typeof text;

/** The ten-step type scale, with line heights in points. */
export const type = Object.fromEntries(
  Object.entries(text).map(([step, t]) => [step, { fontSize: t.size, lineHeight: Math.round(t.size * t.lineHeight) }]),
) as Record<Step, { fontSize: number; lineHeight: number }>;

export function palette(dark: boolean) {
  return { ...(dark ? night : day), ...color };
}

export type Palette = ReturnType<typeof palette>;

/** Lift for a card off the page. The page and the card are only ~1.2:1 apart,
 *  so a card needs more than its hairline border to read as a surface. Two
 *  layers — a tight contact shadow and a long soft one — read as depth where a
 *  single blur reads as a smudge. (`boxShadow` is the same on Android, iOS and web.) */
export function lift(dark: boolean) {
  return {
    boxShadow: dark
      ? '0 1px 2px 0 rgba(0,0,0,0.5), 0 14px 26px -16px rgba(0,0,0,0.75)'
      : '0 1px 2px 0 rgba(0,0,0,0.06), 0 12px 24px -14px rgba(0,0,0,0.24)',
  } as const;
}

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return { dark, c: palette(dark), radius, fonts, type, space, lift: lift(dark) };
}
