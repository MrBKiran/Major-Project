/**
 * The motion kit: small, decorative effects the screens compose — the phone
 * counterpart of the web console's `fx/` folder, drawn from the same tokens.
 *
 *  - `Rise`      a block swings up out of the page in perspective, staggered.
 *  - `TiltCard`  a card leans toward where it is pressed and springs back.
 *  - `RoadStrip` the brand's road in 3D: lane dashes streaming toward a car,
 *                drawn with plain Views under a perspective transform — no
 *                graphics library, so it costs nothing to ship.
 *
 * Built on React Native's own `Animated`, so it runs the same on Android, iOS
 * and the browser preview, and under Jest. Nothing moves when the phone has
 * asked for reduced motion, and none of it is announced by a screen reader: it
 * is decoration, and every word and control stays where it was.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Platform, Pressable, View, type StyleProp, type ViewStyle,
} from 'react-native';

import { useTheme } from '@/theme';

// Web has no native animation driver; asking for it only logs a warning.
const NATIVE = Platform.OS !== 'web';

// Under a test runner, looping timers would keep tests from finishing, and a
// fade-in would hide content from the assertions. Tests see the static screen.
const IN_TEST = typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

/** True when decoration may move: not under test, and the phone has not asked for less motion. */
export function useMotionOk(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((value) => { if (live) setReduced(value); })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', setReduced);
    return () => { live = false; sub?.remove?.(); };
  }, []);
  return !IN_TEST && !reduced;
}

/** A block that rises into place in 3D: tipped back and low, then upright. `index` staggers a list. */
export function Rise({ children, index = 0, style }: { children: ReactNode; index?: number; style?: StyleProp<ViewStyle> }) {
  const ok = useMotionOk();
  const [t] = useState(() => new Animated.Value(ok ? 0 : 1));

  useEffect(() => {
    if (!ok) { t.setValue(1); return undefined; }
    const run = Animated.timing(t, {
      toValue: 1, duration: 700, delay: index * 80, easing: Easing.out(Easing.cubic), useNativeDriver: NATIVE,
    });
    run.start();
    return () => run.stop();
  }, [ok, index, t]);

  if (!ok) return <View style={style}>{children}</View>;
  return (
    <Animated.View
      style={[style, {
        opacity: t,
        transform: [
          { perspective: 900 },
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
          { rotateX: t.interpolate({ inputRange: [0, 1], outputRange: ['12deg', '0deg'] }) },
        ],
      }]}
    >
      {children}
    </Animated.View>
  );
}

/**
 * A card that leans toward the press point and rises a hair, then springs back.
 * The wrapper is not a control — `accessible={false}` keeps it out of TalkBack's
 * focus order — so the controls inside keep working as they always did.
 */
export function TiltCard({ children, max = 7, style }: { children: ReactNode; max?: number; style?: StyleProp<ViewStyle> }) {
  const ok = useMotionOk();
  const size = useRef({ width: 1, height: 1 });
  const [x] = useState(() => new Animated.Value(0));
  const [y] = useState(() => new Animated.Value(0));
  const [lift] = useState(() => new Animated.Value(0));

  const spring = (value: Animated.Value, to: number) =>
    Animated.spring(value, { toValue: to, friction: 6, tension: 120, useNativeDriver: NATIVE }).start();

  if (!ok) return <View style={style}>{children}</View>;
  return (
    <Pressable
      accessible={false}
      focusable={false}
      onLayout={(e) => { size.current = e.nativeEvent.layout; }}
      onPressIn={(e) => {
        spring(x, (e.nativeEvent.locationX / size.current.width - 0.5) * 2);
        spring(y, (e.nativeEvent.locationY / size.current.height - 0.5) * 2);
        spring(lift, 1);
      }}
      onPressOut={() => { spring(x, 0); spring(y, 0); spring(lift, 0); }}
    >
      <Animated.View
        style={[style, {
          transform: [
            { perspective: 900 },
            { rotateX: y.interpolate({ inputRange: [-1, 1], outputRange: [`${max}deg`, `-${max}deg`] }) },
            { rotateY: x.interpolate({ inputRange: [-1, 1], outputRange: [`-${max}deg`, `${max}deg`] }) },
            { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] }) },
          ],
        }]}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
}

const DASH = 30;
const PERIOD = DASH * 2;

/** One column of lane dashes on the road plane; `run` (0→1) slides it one period toward the viewer. */
function DashColumn({ left, width, color, run, rows, opacity = 1 }: {
  left: `${number}%`; width: number; color: string; run: Animated.Value; rows: number; opacity?: number;
}) {
  return (
    <Animated.View
      style={{
        position: 'absolute', left, width, top: -PERIOD, marginLeft: -width / 2, opacity,
        transform: [{ translateY: run.interpolate({ inputRange: [0, 1], outputRange: [0, PERIOD] }) }],
      }}
    >
      {Array.from({ length: rows }, (_, i) => (
        <View key={i} style={{ height: DASH, marginBottom: DASH, backgroundColor: color, borderRadius: 2 }} />
      ))}
    </Animated.View>
  );
}

/**
 * The brand road in perspective with a car on it. The road is a tall plane tipped
 * back with a perspective transform; dashes slide down it, and perspective makes
 * them swell as they near the viewer — the same idea as the web hero's SVG road.
 * Fog is a stack of page-coloured strips fading out the horizon.
 */
export function RoadStrip({ height = 168 }: { height?: number }) {
  const { c, radius } = useTheme();
  const ok = useMotionOk();
  const [run] = useState(() => new Animated.Value(0));
  const [sway] = useState(() => new Animated.Value(0));

  useEffect(() => {
    if (!ok) return undefined;
    const road = Animated.loop(Animated.timing(run, { toValue: 1, duration: 800, easing: Easing.linear, useNativeDriver: NATIVE }));
    const steer = Animated.loop(Animated.sequence([
      Animated.timing(sway, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
      Animated.timing(sway, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: NATIVE }),
    ]));
    road.start();
    steer.start();
    return () => { road.stop(); steer.stop(); };
  }, [ok, run, sway]);

  const planeHeight = height * 2.1;
  const rows = Math.ceil(planeHeight / PERIOD) + 3;
  const fog = [0.95, 0.8, 0.6, 0.4, 0.22, 0.1];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={{
        height, overflow: 'hidden', borderRadius: radius.panel, backgroundColor: c.panel,
        borderWidth: 1, borderColor: c.border,
      }}
    >
      {/* A low sun at the horizon, in the brand orange. */}
      <View style={{
        position: 'absolute', top: height * 0.58, alignSelf: 'center', width: 70, height: 4, borderRadius: 4,
        backgroundColor: c.accent, opacity: 0.55, boxShadow: `0 0 34px 18px ${c.accent}`,
      }} />

      {/* The road: a plane, tipped back so its far end recedes. */}
      <View
        style={{
          position: 'absolute', left: '-40%', width: '180%', height: planeHeight, bottom: -12,
          backgroundColor: c.chrome, overflow: 'hidden',
          transformOrigin: '50% 100%',
          transform: [{ perspective: 320 }, { rotateX: '64deg' }],
        }}
      >
        <View style={{ position: 'absolute', left: '36%', width: 5, top: 0, bottom: 0, backgroundColor: c.borderStrong, opacity: 0.7 }} />
        <View style={{ position: 'absolute', left: '64%', width: 5, top: 0, bottom: 0, backgroundColor: c.borderStrong, opacity: 0.7 }} />
        <DashColumn left="50%" width={9} color={c.accent} run={run} rows={rows} />
        <DashColumn left="43%" width={5} color={c.borderStrong} run={run} rows={rows} opacity={0.5} />
        <DashColumn left="57%" width={5} color={c.borderStrong} run={run} rows={rows} opacity={0.5} />
      </View>

      {/* Fog over the far end, so the road dissolves into the sky instead of ending on a line. */}
      <View style={{ position: 'absolute', top: height * 0.56, left: 0, right: 0 }}>
        {fog.map((o, i) => (
          <View key={i} style={{ height: height * 0.055, backgroundColor: c.panel, opacity: o }} />
        ))}
      </View>

      {/* The car, seen from behind, steering gently. */}
      <Animated.View
        style={{
          position: 'absolute', bottom: 10, alignSelf: 'center', width: 92, height: 46,
          transform: [{ translateX: sway.interpolate({ inputRange: [0, 1], outputRange: [-10, 10] }) }],
        }}
      >
        <View style={{ position: 'absolute', bottom: 0, left: 2, right: 2, height: 9, borderRadius: 46, backgroundColor: 'rgba(0,0,0,0.3)' }} />
        <View style={{
          position: 'absolute', bottom: 22, left: 17, width: 58, height: 20, borderTopLeftRadius: 11, borderTopRightRadius: 11,
          backgroundColor: c.deviceRing, borderWidth: 1, borderColor: c.borderStrong,
        }}>
          <View style={{ position: 'absolute', top: 4, left: 6, right: 6, height: 10, borderRadius: 5, backgroundColor: c.fgSubtle, opacity: 0.4 }} />
        </View>
        <View style={{
          position: 'absolute', bottom: 6, left: 0, right: 0, height: 26, borderRadius: 11,
          backgroundColor: c.deviceRing, borderWidth: 1, borderColor: c.borderStrong,
        }} />
        {([8, 66] as const).map((left) => (
          <View key={left} style={{
            position: 'absolute', bottom: 18, left, width: 18, height: 6, borderRadius: 3, backgroundColor: c.accent,
            boxShadow: `0 0 10px 3px ${c.accent}`,
          }} />
        ))}
        <View style={{ position: 'absolute', bottom: 8, left: 34, width: 24, height: 7, borderRadius: 2, backgroundColor: c.card }} />
        {([6, 70] as const).map((left) => (
          <View key={left} style={{ position: 'absolute', bottom: 3, left, width: 16, height: 9, borderRadius: 3, backgroundColor: c.deviceRing }} />
        ))}
      </Animated.View>
    </View>
  );
}
