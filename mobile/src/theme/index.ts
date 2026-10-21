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
 *  so a card needs more than its hairline border to read as a surface. */
export function lift(dark: boolean) {
  return {
    shadowColor: '#000', shadowOpacity: dark ? 0.4 : 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  } as const;
}

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return { dark, c: palette(dark), radius, fonts, type, space, lift: lift(dark) };
}
