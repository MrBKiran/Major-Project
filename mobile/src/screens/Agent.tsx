/**
 * Talking to the agent — the same conversation the web owner app and the
 * console use, so it resumes where it left off (POST /api/chat/start, /reply).
 * The agent's plan and offered slots come back with every reply and go out
 * with the next; the server keeps no hidden state about them.
 *
 * The soonest slot is offered as one tap, but sent as words ("yes, book it"):
 * a hold is an irreversible tool call that needs the agent's declared plan,
 * which only an explicit yes produces.
 */

import { formatSlot } from '@autosaarthi/core';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { WithCar } from '@/components/car';
import OfflineBanner from '@/components/OfflineBanner';
import { Button, Card, Meta, Notice, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useGarage } from '@/lib/garage';
import { useSession } from '@/lib/session';
import { fonts, space, useTheme } from '@/theme';

interface Turn { role: 'agent' | 'user' | string; text: string; grounded_in?: number }
interface Slot { center_id: string; center_name?: string; slot_start: string }
interface Thread { run_id: string; plan: string[]; offered_slots: Slot[]; objections_handled: number }
interface ChatReply extends Partial<Thread> {
  turns?: Turn[]; done?: boolean; note?: string;
  booking?: { booked?: boolean; slot_start?: string; center_id?: string } | null;
}

export default function Agent() {
  const { state } = useGarage();
  if (state.kind !== 'ready') return <WithCar>{() => null}</WithCar>;
  return <Conversation vin={state.vin} />;
}

function Conversation({ vin }: { vin: string }) {
  const router = useRouter();
  const { api } = useSession();
  const { refreshService } = useGarage();
  const { c, radius, type } = useTheme();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(true);
  const [done, setDone] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);

  const adopt = (res: ChatReply) => {
    if (res.run_id) {
      setThread({ run_id: res.run_id, plan: res.plan ?? [], offered_slots: res.offered_slots ?? [],
                  objections_handled: res.objections_handled ?? 0 });
    }
    if (res.booking?.booked) { setBooked(res.booking.slot_start ?? ''); refreshService(); }
    if (res.done) setDone(true);
  };

  useEffect(() => {
    api.post<ChatReply>('/api/chat/start', { vin })
      .then((res) => {
        if (res.note) { setNote(res.note); setDone(true); return; }
        setTurns(res.turns ?? []);
        adopt(res);
      })
      .catch((e) => setNote(e instanceof ApiError ? e.message : 'Could not reach the agent.'))
      .finally(() => setBusy(false));
    // Once per car: the conversation resumes on the server.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, vin]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || done || !thread) return;
    setInput('');
    setProblem(null);
    setTurns((t) => [...t, { role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await api.post<ChatReply>('/api/chat/reply', { vin, ...thread, message });
      setTurns((t) => [...t, ...(res.turns ?? [])]);
      adopt(res);
    } catch (e) {
      setProblem(e instanceof ApiError ? e.message : 'The message did not go through.');
    } finally {
      setBusy(false);
    }
  }

  const slot = thread?.offered_slots?.[0];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }} edges={['left', 'right', 'bottom']}>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Inverted: newest at the bottom without scrolling to it, and only what is
            on screen is rendered however long the conversation grows. */}
        <FlatList
          inverted
          data={[...turns].reverse()}
          keyExtractor={(_, i) => String(turns.length - i)}
          renderItem={({ item }) => <Bubble turn={item} />}
          contentContainerStyle={{ padding: space[4], gap: space[3] }}
          ListHeaderComponent={
            <View style={{ gap: space[3] }}>
              {problem && <Notice>{problem}</Notice>}
              {busy && <Meta>agent is thinking…</Meta>}
            </View>
          }
          ListFooterComponent={note ? <Txt tone="muted" style={{ textAlign: 'center', paddingVertical: space[5] }}>{note}</Txt> : undefined}
        />

        {booked !== null ? (
          <View style={{ padding: space[4], gap: space[3] }}>
            <Card tone="ok">
              <Meta tone="positive">Confirmed</Meta>
              <Txt step="title" weight="semibold" style={{ marginTop: space[2] }}>{`Booked for ${formatSlot(booked)}`}</Txt>
            </Card>
            <Button kind="ghost" onPress={() => router.back()}>Back to my car</Button>
          </View>
        ) : !note && (
          <View style={{ borderTopWidth: 1, borderTopColor: c.border, padding: space[3], gap: space[3], backgroundColor: c.page }}>
            {slot && !done && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], backgroundColor: c.card,
                             borderWidth: 1, borderColor: c.border, borderRadius: radius.card, padding: space[3] }}>
                <View style={{ flex: 1 }}>
                  <Meta>Soonest slot</Meta>
                  <Txt step="body" weight="semibold">{`${formatSlot(slot.slot_start)} · ${slot.center_name ?? slot.center_id}`}</Txt>
                </View>
                <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy}
                           onPress={() => send('yes, book it')}
                           android_ripple={{ color: c.accentInk, foreground: true }}
                           style={{ minHeight: 48, justifyContent: 'center', paddingHorizontal: space[4], overflow: 'hidden',
                                    borderRadius: radius.control, backgroundColor: busy ? c.control : c.accentDeep }}>
                  <Txt step="body" weight="semibold" tone={busy ? 'subtle' : 'onAccent'}>Book it</Txt>
                </Pressable>
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <TextInput
                accessibilityLabel="Message"
                value={input}
                onChangeText={setInput}
                editable={!done && !busy}
                onSubmitEditing={() => send(input)}
                placeholder={done ? 'Conversation ended' : 'Ask anything about your car…'}
                placeholderTextColor={c.fgSubtle}
                maxFontSizeMultiplier={1.8}
                style={{ flex: 1, minHeight: 48, borderRadius: radius.card, borderWidth: 1, borderColor: c.borderStrong,
                         backgroundColor: c.card, paddingHorizontal: space[4], color: c.fg, fontFamily: fonts.regular, ...type.body }}
              />
              <Pressable accessibilityRole="button" accessibilityLabel="Send"
                         accessibilityState={{ disabled: done || busy || !input.trim() }}
                         disabled={done || busy || !input.trim()} onPress={() => send(input)}
                         android_ripple={{ color: c.accentInk, foreground: true }}
                         style={{ overflow: 'hidden', minWidth: 56, minHeight: 48, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center',
                                  backgroundColor: done || busy || !input.trim() ? c.control : c.accentDeep }}>
                <Txt step="body" weight="semibold" tone={done || busy || !input.trim() ? 'subtle' : 'onAccent'}>Send</Txt>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const { c, radius } = useTheme();
  const mine = turn.role === 'user';
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        accessible
        accessibilityLabel={`${mine ? 'You' : 'Agent'}: ${turn.text}`}
        style={{
          maxWidth: '86%', paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: radius.panel,
          borderBottomRightRadius: mine ? 5 : radius.panel, borderBottomLeftRadius: mine ? radius.panel : 5,
          backgroundColor: mine ? c.accentDeep : c.card, borderWidth: mine ? 0 : 1, borderColor: c.border,
        }}
      >
        {!mine && (turn.grounded_in ?? 0) > 0 && <Meta tone="positive">{`from ${turn.grounded_in} facts about your car`}</Meta>}
        <Txt step="body" tone={mine ? 'onAccent' : 'fg'}>{turn.text}</Txt>
      </View>
    </View>
  );
}
