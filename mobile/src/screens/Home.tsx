/**
 * Home: one car, one sentence. The rule from the wireframe deck the web owner
 * app is also built on: "a healthy vehicle should be a quiet screen" — no KPI
 * grid, nothing to tap. An alert says what is wearing, how long is left and
 * what each choice costs; a booking says when.
 *
 * Laid out like the web owner app's card, with the same words (OWNER in
 * packages/core), so an owner sees one product on the phone and the web.
 */

import {
  alertBadge, alertSpoken, drivingLeft, formatDate, formatSlot, humanize, OWNER, wearingOut,
} from '@autosaarthi/core';
import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { CostRows, WithCar } from '@/components/car';
import { Rise, RoadStrip, TiltCard } from '@/components/fx';
import { Button, Card, Meta, Pill, Txt } from '@/components/ui';
import type { Detail, Service } from '@/lib/garage';
import { space } from '@/theme';

export default function Home() {
  return <WithCar>{({ detail, service }) => <HomeBody detail={detail} service={service} />}</WithCar>;
}

function HomeBody({ detail, service }: { detail: Detail; service: Service }) {
  const router = useRouter();
  const { alert, booking } = service;
  const last = detail.maintenance_history[0];
  const facts = [service.vin, service.odometer != null ? `${service.odometer.toLocaleString('en-IN')} km` : null, service.city]
    .filter(Boolean).join(' · ');

  return (
    <>
      <Rise index={0} style={{ gap: space[1] }}>
        <Txt step="display" weight="semibold" accessibilityRole="header">{service.model}</Txt>
        <Txt step="label" mono tone="subtle">{facts}</Txt>
      </Rise>

      {/* The brand road, in 3D, with the car on it — decoration only. */}
      <Rise index={1}><RoadStrip /></Rise>

      {booking && (
        <Rise index={2}>
        <Card tone="ok">
          <Meta tone="positive">{booking.status === 'booked' ? 'Confirmed' : 'Held'}</Meta>
          <Txt step="title" weight="semibold" style={{ marginTop: space[2] }}>Service booked</Txt>
          <Txt tone="secondary" style={{ marginTop: space[1] }}>{`${formatSlot(booking.slot_start)} · ${booking.center_name}`}</Txt>
          <View style={{ marginTop: space[4] }}>
            <Button kind="ghost" onPress={() => router.push('/book')}>Change or cancel</Button>
          </View>
        </Card>
        </Rise>
      )}

      {alert ? (
        <Rise index={3}><TiltCard>
        <Card>
          <Pill tone={alert.severity === 'P1' ? 'p1' : 'amber'} label={alertSpoken(alert)}>{alertBadge(alert)}</Pill>
          <Txt step="display" weight="semibold" style={{ marginTop: space[3] }}>{wearingOut(alert.component)}</Txt>
          <Txt step="lead" tone="secondary" style={{ marginTop: space[2] }}>
            {alert.days_to_failure != null
              ? `${drivingLeft(alert.days_to_failure)}, on current use.`
              : 'Wear is progressing on your current use.'}
          </Txt>
          {service.economics && <View style={{ marginTop: space[5] }}><CostRows economics={service.economics} /></View>}
          <View style={{ marginTop: space[4], flexDirection: 'row', gap: space[2] }}>
            <Button kind="ghost" grow onPress={() => router.push('/evidence')}>{OWNER.whyThisPart}</Button>
            <Button kind="ghost" grow onPress={() => router.push('/agent')}>{OWNER.talkToAgent}</Button>
          </View>
          {!booking && (
            <View style={{ marginTop: space[3], gap: space[3] }}>
              <Button onPress={() => router.push('/book')}>{OWNER.book}</Button>
              <Txt step="label" tone="subtle" style={{ textAlign: 'center' }}>{OWNER.nothingBooked}</Txt>
            </View>
          )}
        </Card>
        </TiltCard></Rise>
      ) : !booking && (
        <Rise index={3}><TiltCard>
        <Card>
          <Meta tone="positive">Healthy · agent watching</Meta>
          <Txt step="display" weight="semibold" style={{ marginTop: space[3] }}>{OWNER.healthyTitle}</Txt>
          <Txt step="lead" tone="secondary" style={{ marginTop: space[2] }}>{OWNER.healthyBody}</Txt>
        </Card>
        </TiltCard></Rise>
      )}

      {last && (
        <Rise index={4}>
          <Txt step="bodySm" tone="muted">
            {`Last service · ${formatDate(last.date)} · ${humanize(last.service_type)}`}
          </Txt>
        </Rise>
      )}
    </>
  );
}
