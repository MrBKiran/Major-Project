/**
 * Book, move or cancel the car's service.
 *
 * The server keeps one booking per car and moves one in a single step, so a
 * slot that goes while the owner is choosing leaves the old booking exactly as
 * it was (POST /api/vehicles/{vin}/service/book | reschedule | cancel). When
 * that happens this screen says so and shows what is still open.
 */

import { formatSlot } from '@autosaarthi/core';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { WithCar } from '@/components/car';
import { Button, Card, Meta, Notice, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useGarage, type Service, type Slot } from '@/lib/garage';
import { useSession } from '@/lib/session';
import { space, useTheme } from '@/theme';

const keyOf = (s: Slot) => `${s.center_id}|${s.slot_start}`;

export default function Book() {
  return <WithCar>{({ service }) => <BookBody service={service} />}</WithCar>;
}

function BookBody({ service }: { service: Service }) {
  const router = useRouter();
  const { api } = useSession();
  const { refreshService } = useGarage();
  const [chosen, setChosen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { booking, slots } = service;
  // The choice survives a refresh only if that slot is still open.
  const slot = slots.find((s) => keyOf(s) === chosen) ?? slots[0] ?? null;

  async function act(action: 'book' | 'reschedule' | 'cancel', body?: object) {
    setBusy(true);
    setProblem(null);
    try {
      await api.post(`/api/vehicles/${service.vin}/service/${action}`, body);
      await refreshService();
      router.back();
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
      // A refusal usually means the slot went: show what is open now.
      if (e instanceof ApiError && !e.offline) await refreshService();
    } finally {
      setBusy(false);
    }
  }

  const pick = slot && { center_id: slot.center_id, slot_start: slot.slot_start };

  return (
    <>
      <Meta>{service.model}</Meta>

      {booking && (
        <Card tone="ok">
          <Txt step="lead" weight="medium">{`Booked for ${formatSlot(booking.slot_start)} at ${booking.center_name}`}</Txt>
          <View style={{ marginTop: space[3], gap: space[3] }}>
            {!confirmingCancel ? (
              <Button kind="ghost" onPress={() => setConfirmingCancel(true)} disabled={busy}>Cancel this booking</Button>
            ) : (
              <>
                <Txt tone="secondary">Cancel this booking? The bay goes back to other owners.</Txt>
                <Button onPress={() => act('cancel')} busy={busy}>Yes, cancel it</Button>
                <Button kind="ghost" onPress={() => setConfirmingCancel(false)} disabled={busy}>Keep it</Button>
              </>
            )}
          </View>
        </Card>
      )}

      {slots.length === 0 ? (
        <Card>
          <Txt tone="secondary">
            {`No open slots in ${service.city ?? 'your city'} in the next two weeks. The agent can ask the centre for you.`}
          </Txt>
          <View style={{ marginTop: space[3] }}>
            <Button kind="ghost" onPress={() => router.push('/agent')}>Talk to the agent</Button>
          </View>
        </Card>
      ) : (
        <View style={{ gap: space[3] }}>
          <Txt step="label" weight="medium" tone="muted">{booking ? 'Move it to' : 'Open slots near you'}</Txt>
          <View accessibilityRole="radiogroup" style={{ gap: space[2] }}>
            {slots.map((s) => (
              <SlotRow key={keyOf(s)} slot={s} selected={slot !== null && keyOf(s) === keyOf(slot)}
                       onPress={() => setChosen(keyOf(s))} />
            ))}
          </View>
          {pick && slot && (booking ? (
            <Button onPress={() => act('reschedule', pick)} busy={busy}>{`Move to ${formatSlot(slot.slot_start)}`}</Button>
          ) : (
            <Button onPress={() => act('book', pick)} busy={busy}>{`Book ${formatSlot(slot.slot_start)}`}</Button>
          ))}
        </View>
      )}

      {problem && <Notice>{problem}</Notice>}
    </>
  );
}

function SlotRow({ slot, selected, onPress }: { slot: Slot; selected: boolean; onPress: () => void }) {
  const { c, radius } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${formatSlot(slot.slot_start)}, ${slot.center_name}`}
      onPress={onPress}
      android_ripple={{ color: c.insetStrong, foreground: true }}
      style={{
        minHeight: 56, borderRadius: radius.card, borderWidth: selected ? 2 : 1, overflow: 'hidden',
        borderColor: selected ? c.accentDeep : c.border, backgroundColor: c.card,
        paddingHorizontal: space[4], paddingVertical: space[3], flexDirection: 'row', alignItems: 'center', gap: space[3],
      }}
    >
      {/* The state is shown by a dot, not only by the border's weight (WCAG 1.4.11). */}
      <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2,
                     borderColor: selected ? c.accentDeep : c.borderStrong, alignItems: 'center', justifyContent: 'center' }}>
        {selected && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.accentDeep }} />}
      </View>
      <View style={{ flex: 1 }}>
        <Txt step="lead" weight="medium">{formatSlot(slot.slot_start)}</Txt>
        <Txt step="bodySm" tone="muted">{slot.center_name}</Txt>
      </View>
    </Pressable>
  );
}
