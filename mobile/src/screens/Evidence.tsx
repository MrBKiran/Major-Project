/**
 * "Why this part?" — the evidence behind the alert: how sure the model is, the
 * reading that shows the wear and which way it is going, any trouble codes,
 * and what each choice costs.
 *
 * Readings taken with the ignition off are not evidence of wear (the coolant
 * is cold because the car is parked), so the trend uses engine-running rows —
 * the same ones the agent quotes a number from.
 */

import { alertBadge, alertSpoken, componentLabel, componentSignal, confidence, SIGNALS, trendSentence } from '@autosaarthi/core';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { CostRows, WithCar } from '@/components/car';
import { Button, Card, Meta, Pill, Txt } from '@/components/ui';
import type { Detail, Reading, Service } from '@/lib/garage';
import { space, useTheme } from '@/theme';

export default function Evidence() {
  return <WithCar>{({ detail, service }) => <EvidenceBody detail={detail} service={service} />}</WithCar>;
}

function engineRunning(series: Reading[]): Reading[] {
  const running = series.filter((r) => r.drive_state && r.drive_state !== 'IGNITION_OFF');
  return running.length ? running : series;
}

function EvidenceBody({ detail, service }: { detail: Detail; service: Service }) {
  const router = useRouter();
  const { alert } = service;

  if (!alert) {
    return (
      <>
        <Txt step="display" weight="semibold" accessibilityRole="header">Why this part</Txt>
        <Txt tone="muted">No active prediction to explain.</Txt>
      </>
    );
  }

  const prediction = detail.predictions.find((p) => p.component === alert.component);
  const signal = componentSignal(alert.component);
  const meta = signal ? SIGNALS[signal.key as keyof typeof SIGNALS] : null;
  const values = signal
    ? engineRunning(detail.series).map((r) => r[signal.key]).filter((v): v is number => typeof v === 'number')
    : [];
  const label = componentLabel(alert.component);
  const sure = confidence(prediction?.failure_prob);
  const trend = trendSentence(alert.component, values);

  return (
    <>
      <View style={{ gap: space[2] }}>
        <Pill tone={alert.severity === 'P1' ? 'p1' : 'amber'} label={alertSpoken(alert)}>{alertBadge(alert)}</Pill>
        <Txt step="display" weight="semibold" accessibilityRole="header">
          {label[0].toUpperCase() + label.slice(1)}
        </Txt>
      </View>

      {sure && (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3], flexWrap: 'wrap' }}>
          <Txt step="hero" mono weight="semibold">{sure.percent}</Txt>
          <Txt tone="secondary">{`${sure.words} — how sure the model is`}</Txt>
        </View>
      )}

      <View style={{ gap: space[2] }}>
        <Txt step="title" weight="semibold">Why we think so</Txt>
        {/* Only as strong as the readings: no drift is claimed that the last
            day's engine-running values do not show. */}
        <Txt tone="secondary">{trend ?? 'The model flagged this from your car’s earlier readings.'}</Txt>
      </View>

      {meta && (
        <Card>
          {values.length ? (
            <>
              <Trend values={values} summary={`${meta.label}, last 24 hours: from ${values[0].toFixed(1)} to ${values[values.length - 1].toFixed(1)} ${meta.unit}`} />
              <View style={{ marginTop: space[3], flexDirection: 'row', justifyContent: 'space-between' }}>
                <Meta>{`${meta.label} · last 24 h`}</Meta>
                <Txt step="bodySm" mono>{`${values[values.length - 1].toFixed(1)} ${meta.unit}`}</Txt>
              </View>
            </>
          ) : (
            <Txt tone="muted">No readings in the last 24 hours. The trend shows once the car has been driven.</Txt>
          )}
        </Card>
      )}

      <View style={{ gap: space[2] }}>
        <Meta>Trouble codes</Meta>
        {detail.dtc_codes.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {detail.dtc_codes.map((code) => <Pill key={code}>{code}</Pill>)}
          </View>
        ) : (
          <Txt step="bodySm" tone="muted">None fired yet — this is a trend, caught before a code sets.</Txt>
        )}
      </View>

      <CostRows economics={service.economics} />
      <Button onPress={() => router.push('/book')}>See open slots</Button>
    </>
  );
}

/** A still bar strip — no animation — read aloud as one sentence. */
function Trend({ values, summary }: { values: number[]; summary: string }) {
  const { c } = useTheme();
  const recent = values.slice(-48);
  const lo = Math.min(...recent);
  const span = Math.max(...recent) - lo || 1;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}
          style={{ flexDirection: 'row', alignItems: 'flex-end', height: 64, gap: 2 }}>
      {recent.map((v, i) => (
        <View key={i} style={{
          flex: 1, borderRadius: 2, height: 8 + ((v - lo) / span) * 56,
          backgroundColor: i === recent.length - 1 ? c.accentDeep : c.fgDecorative,
        }} />
      ))}
    </View>
  );
}
