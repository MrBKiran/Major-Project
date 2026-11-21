/**
 * The browser preview's tabs. Native tabs fall back on the web to a floating
 * bar over the content; this keeps the phone's layout instead — content above,
 * three tabs along the bottom.
 */

import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { useEffect, useState } from 'react';
import { Animated, Pressable } from 'react-native';

import { useMotionOk } from '@/components/fx';
import { Txt } from '@/components/ui';
import { useTheme } from '@/theme';

// React 19: `ref` arrives as an ordinary prop, so no forwardRef.
function TabButton({ label, isFocused, ...props }: Omit<TabTriggerSlotProps, 'ref'> & { label: string }) {
  const { c } = useTheme();
  const ok = useMotionOk();
  // 0 → 1 as the tab becomes current: the bar above it springs open from the
  // middle and the label lifts a little. Instant when motion is off.
  const [on] = useState(() => new Animated.Value(isFocused ? 1 : 0));
  useEffect(() => {
    if (!ok) { on.setValue(isFocused ? 1 : 0); return; }
    Animated.spring(on, { toValue: isFocused ? 1 : 0, friction: 6, tension: 150, useNativeDriver: false }).start();
  }, [isFocused, ok, on]);

  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: isFocused }}
               style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', top: 0, left: '24%', right: '24%', height: 3, borderRadius: 2,
                              backgroundColor: c.accentDeep, opacity: on, transform: [{ scaleX: on }] }} />
      <Animated.View style={{ transform: [{ translateY: on.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }] }}>
        <Txt step="label" weight={isFocused ? 'semibold' : 'regular'} tone={isFocused ? 'fg' : 'muted'}>{label}</Txt>
      </Animated.View>
    </Pressable>
  );
}

export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <Tabs style={{ flex: 1 }}>
      <TabSlot />
      <TabList style={{ flexDirection: 'row', backgroundColor: c.panel, borderTopWidth: 1, borderTopColor: c.border }}>
        <TabTrigger name="index" href="/" asChild><TabButton label="My car" /></TabTrigger>
        <TabTrigger name="history" href="/history" asChild><TabButton label="History" /></TabTrigger>
        <TabTrigger name="account" href="/account" asChild><TabButton label="Account" /></TabTrigger>
      </TabList>
    </Tabs>
  );
}
