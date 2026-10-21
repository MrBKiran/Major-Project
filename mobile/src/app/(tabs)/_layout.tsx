import { NativeTabs } from 'expo-router/native-tabs';

import { useTheme } from '@/theme';

/** Three tabs: the car, its history, the account. Material Symbols on Android, SF Symbols on iOS. */
export default function TabsLayout() {
  const { c } = useTheme();
  return (
    <NativeTabs backgroundColor={c.panel} indicatorColor={c.insetStrong} labelStyle={{ selected: { color: c.fg } }}>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>My car</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="car.fill" md="directions_car" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="history">
        <NativeTabs.Trigger.Label>History</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="clock.fill" md="history" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="account">
        <NativeTabs.Trigger.Label>Account</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="person.crop.circle" md="account_circle" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
