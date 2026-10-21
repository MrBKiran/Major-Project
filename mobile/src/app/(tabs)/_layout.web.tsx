/**
 * The browser preview's tabs. Native tabs fall back on the web to a floating
 * bar over the content; this keeps the phone's layout instead — content above,
 * three tabs along the bottom.
 */

import { TabList, Tabs, TabSlot, TabTrigger, type TabTriggerSlotProps } from 'expo-router/ui';
import { Pressable } from 'react-native';

import { Txt } from '@/components/ui';
import { useTheme } from '@/theme';

// React 19: `ref` arrives as an ordinary prop, so no forwardRef.
function TabButton({ label, isFocused, ...props }: Omit<TabTriggerSlotProps, 'ref'> & { label: string }) {
  const { c } = useTheme();
  return (
    <Pressable {...props} accessibilityRole="tab" accessibilityState={{ selected: isFocused }}
               style={{ flex: 1, minHeight: 56, alignItems: 'center', justifyContent: 'center',
                        borderTopWidth: 2, borderTopColor: isFocused ? c.accentDeep : 'transparent' }}>
      <Txt step="label" weight={isFocused ? 'semibold' : 'regular'} tone={isFocused ? 'fg' : 'muted'}>{label}</Txt>
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
