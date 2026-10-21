/**
 * The app's building blocks. Every tappable thing is at least 48 points, has a
 * role and a name for TalkBack, answers a press the way the platform does (a
 * ripple on Android), and every text scales with the phone's font size (capped
 * so a layout built for one sentence never becomes unreadable). Spacing comes
 * from the shared 4-point scale (packages/tokens `space`).
 */

import type { ReactNode } from 'react';
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
  type TextInputProps, type TextProps, type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { fonts, type Palette, space, type Step, useTheme } from '@/theme';

import OfflineBanner from './OfflineBanner';

const MAX_SCALE = 1.8;

type Tone = 'fg' | 'strong' | 'secondary' | 'muted' | 'subtle' | 'link' | 'positive' | 'alert' | 'onAccent';
type Weight = 'regular' | 'medium' | 'semibold' | 'bold';

function toneColor(c: Palette, tone: Tone): string {
  return {
    fg: c.fg, strong: c.fgStrong, secondary: c.fgSecondary, muted: c.fgMuted, subtle: c.fgSubtle,
    link: c.link, positive: c.positive, alert: c.pillInk, onAccent: c.onAccent,
  }[tone];
}

export function Txt({ step = 'body', tone = 'fg', weight = 'regular', mono = false, style, ...rest }:
  TextProps & { step?: Step; tone?: Tone; weight?: Weight; mono?: boolean }) {
  const { c, type } = useTheme();
  return (
    <Text
      maxFontSizeMultiplier={MAX_SCALE}
      style={[type[step], { color: toneColor(c, tone), fontFamily: mono ? fonts.mono : fonts[weight] }, style]}
      {...rest}
    />
  );
}

/** Metadata voice: small, uppercase, mono — status and labels, not sentences. */
export function Meta({ children, tone = 'subtle' }: { children: ReactNode; tone?: Tone }) {
  return (
    <Txt step="caption" mono tone={tone} style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
      {children}
    </Txt>
  );
}

export function Screen({ children, scroll = true }: { children: ReactNode; scroll?: boolean }) {
  const { c } = useTheme();
  const body = <View style={styles.screenBody}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }} edges={['top', 'left', 'right']}>
      <OfflineBanner />
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">{body}</ScrollView> : body}
    </SafeAreaView>
  );
}

export function Card({ children, style, tone = 'card' }: { children: ReactNode; style?: ViewStyle; tone?: 'card' | 'alert' | 'ok' }) {
  const { c, radius, lift } = useTheme();
  const bg = { card: c.card, alert: c.alertBg, ok: c.okBg }[tone];
  const border = { card: c.border, alert: c.pillBg, ok: c.okBorder }[tone];
  return (
    <View style={[
      { backgroundColor: bg, borderColor: border, borderWidth: 1, borderRadius: radius.panel, padding: space[5] },
      tone === 'card' && lift, style,
    ]}>
      {children}
    </View>
  );
}

export function Pill({ children, tone = 'p1', label }: { children: ReactNode; tone?: 'p1' | 'amber' | 'ok'; label?: string }) {
  const { c, radius } = useTheme();
  const [bg, ink] = { p1: [c.pillBg, c.pillInk], amber: [c.amberBg, c.amberInk], ok: [c.okBg, c.positive] }[tone];
  return (
    <View accessible={Boolean(label)} accessibilityLabel={label}
          style={{ alignSelf: 'flex-start', backgroundColor: bg, borderRadius: radius.chip, paddingHorizontal: space[2], paddingVertical: space[1] }}>
      <Txt step="caption" mono weight="medium" style={{ color: ink, textTransform: 'uppercase', letterSpacing: 1 }}>{children}</Txt>
    </View>
  );
}

export function Button({ children, onPress, kind = 'primary', disabled = false, busy = false, hint, grow = false }: {
  children: string; onPress?: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean; busy?: boolean; hint?: string;
  grow?: boolean;
}) {
  const { c, radius } = useTheme();
  const off = disabled || busy;
  const primary = kind === 'primary';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: off, busy }}
      accessibilityHint={hint}
      disabled={off}
      onPress={onPress}
      android_ripple={{ color: primary ? c.accentInk : c.insetStrong, foreground: true }}
      style={({ pressed }) => ({
        flex: grow ? 1 : undefined, overflow: 'hidden',
        minHeight: primary ? 56 : 48, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center',
        paddingHorizontal: space[4], paddingVertical: space[3],
        // White text sits on accentDeep (4.8:1), never on the plain accent (3.4:1).
        backgroundColor: primary ? (off ? c.control : c.accentDeep) : c.card,
        borderWidth: primary ? 0 : 1, borderColor: c.border,
        opacity: pressed ? 0.9 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={primary ? c.onAccent : c.fg} accessibilityLabel="Working" />
        : <Txt step={primary ? 'titleSm' : 'body'} weight="semibold" style={{ textAlign: 'center' }}
               tone={primary ? (off ? 'subtle' : 'onAccent') : off ? 'subtle' : 'fg'}>{children}</Txt>}
    </Pressable>
  );
}

export function Field({ label, error, ...input }: TextInputProps & { label: string; error?: string | null }) {
  const { c, radius, type } = useTheme();
  return (
    <View style={{ gap: space[2] }}>
      <Txt step="label" weight="medium" tone="muted">{label}</Txt>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.fgSubtle}
        maxFontSizeMultiplier={MAX_SCALE}
        style={{
          ...type.lead, fontFamily: fonts.regular, color: c.fg, backgroundColor: c.card,
          // borderStrong, not border: the outline is how the field is found (WCAG 1.4.11, 3:1).
          borderWidth: 1, borderColor: error ? c.pillInk : c.borderStrong, borderRadius: radius.control,
          minHeight: 52, paddingHorizontal: space[4],
        }}
        {...input}
      />
    </View>
  );
}

/** A message the screen reader announces as it appears. */
export function Notice({ children, tone = 'alert' }: { children: ReactNode; tone?: 'alert' | 'info' }) {
  const { c, radius } = useTheme();
  return (
    <View
      accessible
      accessibilityRole={tone === 'alert' ? 'alert' : 'text'}
      accessibilityLiveRegion="polite"
      style={{ backgroundColor: tone === 'alert' ? c.alertBg : c.inset, borderRadius: radius.control, padding: space[3] }}
    >
      <Txt step="bodySm" tone={tone === 'alert' ? 'alert' : 'secondary'}>{children}</Txt>
    </View>
  );
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const { c } = useTheme();
  return (
    <View style={styles.center} accessible accessibilityRole="progressbar" accessibilityLabel={label}>
      <ActivityIndicator color={c.fgMuted} />
    </View>
  );
}

/** Grey blocks in the shape of what is coming, so nothing jumps when it arrives. */
export function Skeleton({ label, blocks }: { label: string; blocks: { height: number; width?: `${number}%` }[] }) {
  const { c, radius } = useTheme();
  return (
    <View accessible accessibilityRole="progressbar" accessibilityLabel={label} style={{ gap: space[3] }}>
      {blocks.map((b, i) => (
        <View key={i} style={{ height: b.height, width: b.width ?? '100%', borderRadius: radius.control, backgroundColor: c.insetStrong }} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screenBody: { flex: 1, padding: space[5], gap: space[4] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6] },
});
