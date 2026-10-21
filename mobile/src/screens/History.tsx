/** Service history: every visit, newest first, in words rather than codes. */

import { formatDate, formatINR, humanize } from '@autosaarthi/core';
import { View } from 'react-native';

import { WithCar } from '@/components/car';
import { Card, Txt } from '@/components/ui';
import type { Detail } from '@/lib/garage';
import { space, useTheme } from '@/theme';

export default function History() {
  return <WithCar>{({ detail }) => <HistoryBody detail={detail} />}</WithCar>;
}

function HistoryBody({ detail }: { detail: Detail }) {
  const { c, radius } = useTheme();
  const visits = detail.maintenance_history;
  return (
    <>
      <Txt step="display" weight="semibold" accessibilityRole="header">Service history</Txt>
      {visits.length === 0 ? (
        <Txt tone="muted">No service visits on record for this car yet.</Txt>
      ) : visits.map((v, i) => (
        <Card key={`${v.date}-${i}`}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space[3] }}>
            <Txt step="lead" weight="semibold" style={{ flex: 1 }}>{humanize(v.service_type || 'service')}</Txt>
            {v.cost != null && <Txt step="body" mono>{formatINR(v.cost)}</Txt>}
          </View>
          <Txt step="bodySm" tone="muted" style={{ marginTop: space[1] }}>
            {`${formatDate(v.date)}${v.km_at_service ? ` · ${Number(v.km_at_service).toLocaleString('en-IN')} km` : ''}`}
          </Txt>
          {Array.isArray(v.components_replaced) && v.components_replaced.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[3] }}>
              {v.components_replaced.map((part) => (
                <View key={part} style={{ backgroundColor: c.inset, borderRadius: radius.chip, paddingHorizontal: space[2], paddingVertical: space[1] }}>
                  <Txt step="caption" mono tone="muted">{part.replace(/_/g, ' ')}</Txt>
                </View>
              ))}
            </View>
          )}
        </Card>
      ))}
    </>
  );
}
