/** Pieces shared by the screens about the car. */

import { formatINR, OWNER } from '@autosaarthi/core';
import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGarage, type Detail, type Service } from '@/lib/garage';
import { space, useTheme } from '@/theme';

import OfflineBanner from './OfflineBanner';
import { Button, Notice, Screen, Skeleton, Txt } from './ui';

/** Loading, no car, and failure — handled once, for every screen about the car. */
export function WithCar({ children }: { children: (car: { vin: string; detail: Detail; service: Service }) => ReactNode }) {
  const { state, reload, refreshing } = useGarage();
  const { c } = useTheme();

  if (state.kind === 'loading') {
    return (
      <Screen scroll={false}>
        <Skeleton label="Loading your car" blocks={[
          { height: 12, width: '30%' }, { height: 30, width: '55%' }, { height: 14, width: '40%' }, { height: 220 },
        ]} />
      </Screen>
    );
  }
  if (state.kind === 'none') {
    return (
      <Screen>
        <Txt step="title" weight="semibold" accessibilityRole="header">No car yet</Txt>
        <Txt tone="muted">No car is registered to this account yet. Your service centre adds it when they register you.</Txt>
      </Screen>
    );
  }
  if (state.kind === 'failed') {
    return (
      <Screen>
        <Notice>{state.message}</Notice>
        <Button kind="ghost" onPress={reload}>Try again</Button>
      </Screen>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }} edges={['top', 'left', 'right']}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={{ padding: space[5], gap: space[4], flexGrow: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={c.fgMuted} colors={[c.accentDeep]} />}
      >
        {children(state)}
      </ScrollView>
    </SafeAreaView>
  );
}

/** "Repair now ₹5,200 / If it fails on the road ₹18,500" — the pair the agent quotes. */
export function CostRows({ economics }: { economics: Service['economics'] }) {
  const { c, radius } = useTheme();
  if (!economics) return null;
  const rows: [string, number, boolean][] = [
    [OWNER.repairNow, economics.repair_inr, false],
    [OWNER.failsOnRoad, economics.breakdown_inr, true],
  ];
  return (
    <View style={{ borderWidth: 1, borderColor: c.border, borderRadius: radius.card, overflow: 'hidden' }}>
      {rows.map(([label, amount, bad], i) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: ${formatINR(amount)}`}
          style={{
            flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3],
            paddingHorizontal: space[4], paddingVertical: space[3], backgroundColor: c.card,
            borderTopWidth: i ? 1 : 0, borderTopColor: c.border,
          }}
        >
          <Txt step="body" tone="muted" style={{ flexShrink: 1 }}>{label}</Txt>
          <Txt step="titleSm" mono weight="semibold" tone={bad ? 'alert' : 'fg'}>{formatINR(amount)}</Txt>
        </View>
      ))}
    </View>
  );
}
