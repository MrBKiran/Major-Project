/**
 * The assistant — one conversation about every car the owner has, by typing or by voice.
 *
 * It replaces the one-car booking chat. The server (/api/assistant/*) keeps the thread and
 * a longer memory, so it resumes where it left off; it can look up the whole garage and
 * explain things, but it cannot book anything itself. When it wants to book, move or
 * cancel, it PROPOSES, and the owner's tap on "Yes, do it" (or saying yes) is what runs it.
 *
 * Voice: tap the microphone, speak, tap again. The clip is turned into text by the server
 * (Hindi and Hinglish included) and sent like a typed message; the reply is then read aloud
 * with the phone's own voice. Typed questions are answered in writing unless the owner has
 * turned "Read replies aloud" on.
 */

import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Switch, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import OfflineBanner from '@/components/OfflineBanner';
import { Button, Card, Meta, Notice, Txt } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { useGarage } from '@/lib/garage';
import { useSession } from '@/lib/session';
import { speak, stopSpeaking, useRecorder, type Clip } from '@/lib/voice';
import { fonts, space, useTheme } from '@/theme';

interface Turn { id: string; role: 'user' | 'assistant'; text: string }
interface Pending { id: string; kind: string; summary: string }
interface ThreadResponse { turns: { id: number; role: string; text: string }[]; pending_action: Pending | null }
interface MessageResponse { reply: string; pending_action: Pending | null; done: { ok: boolean } | null }
interface ActionResponse { ok: boolean; message: string }

const SUGGESTIONS = [
  'How are my cars doing?',
  'What will it cost if I wait?',
  'Book me a service',
  'What does my warning mean?',
];

let nextLocal = 0;
const localId = () => `local-${++nextLocal}`;

export default function Assistant() {
  const router = useRouter();
  const { api } = useSession();
  const { state, refreshService } = useGarage();
  const { c, radius, type } = useTheme();
  // At the length limit the recorder cuts itself off; what was said so far is still sent.
  const clipHandler = useRef<(clip: Clip | null) => void>(() => undefined);
  const recorder = useRecorder((clip) => clipHandler.current(clip));
  const vin = state.kind === 'ready' ? state.vin : undefined;

  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [readAloud, setReadAloud] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const alive = useRef(true);

  useEffect(() => () => { alive.current = false; stopSpeaking(); }, []);

  useEffect(() => {
    api.get<ThreadResponse>('/api/assistant/thread')
      .then((res) => {
        setTurns(res.turns.map((t) => ({ id: `t-${t.id}`, role: t.role === 'user' ? 'user' : 'assistant', text: t.text })));
        setPending(res.pending_action);
      })
      .catch((e) => setProblem(e instanceof ApiError ? e.message : 'Could not reach the assistant.'))
      .finally(() => setLoading(false));
  }, [api]);

  const say = useCallback((text: string) => {
    setSpeaking(true);
    speak(text, () => { if (alive.current) setSpeaking(false); });
  }, []);

  const fail = (e: unknown, fallback: string) => setProblem(e instanceof ApiError ? e.message : fallback);

  async function send(text: string, channel: 'text' | 'voice' = 'text') {
    const message = text.trim();
    if (!message || busy) return;
    stopSpeaking();
    setInput('');
    setProblem(null);
    setTurns((t) => [...t, { id: localId(), role: 'user', text: message }]);
    setBusy(true);
    try {
      const res = await api.post<MessageResponse>('/api/assistant/message', { message, channel, vin });
      setTurns((t) => [...t, { id: localId(), role: 'assistant', text: res.reply }]);
      setPending(res.pending_action);
      if (res.done?.ok) await refreshService();
      if (channel === 'voice' || readAloud) say(res.reply);
    } catch (e) {
      fail(e, 'The message did not go through.');
    } finally {
      setBusy(false);
    }
  }

  async function decide(kind: 'confirm' | 'cancel') {
    if (!pending || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post<ActionResponse>(`/api/assistant/actions/${pending.id}/${kind}`);
      setTurns((t) => [...t, { id: localId(), role: 'user', text: kind === 'confirm' ? 'Yes, go ahead.' : 'No, leave it.' },
                            { id: localId(), role: 'assistant', text: res.message }]);
      setPending(null);
      if (res.ok && kind === 'confirm') await refreshService();
      if (readAloud) say(res.message);
    } catch (e) {
      fail(e, 'That did not go through.');
    } finally {
      setBusy(false);
    }
  }

  async function toggleMic() {
    if (busy) return;
    setProblem(null);
    if (!recorder.recording) {
      stopSpeaking();
      setSpeaking(false);
      try {
        if (!(await recorder.start())) setProblem('Allow the microphone to talk to the assistant, or type your question instead.');
      } catch {
        setProblem('The microphone could not start. Type your question instead.');
      }
      return;
    }
    await sendClip(await recorder.stop());
  }

  /** Transcribe a finished clip and ask what it says. Used for a tap on stop, and for the cut-off at the length limit. */
  async function sendClip(clip: Clip | null) {
    setBusy(true);
    let heard: string | null = null;
    try {
      if (clip) {
        const form = new FormData();
        // React Native's FormData takes a { uri, name, type } descriptor for a file.
        form.append('audio', { uri: clip.uri, name: clip.name, type: clip.type } as unknown as Blob);
        const { text } = await api.upload<{ text: string }>('/api/assistant/transcribe', form);
        if (text.trim()) heard = text; else setProblem('I did not catch that. Try again, a little closer to the phone.');
      }
    } catch (e) {
      fail(e, 'I could not hear that. Type your question instead.');
    } finally {
      setBusy(false);
    }
    if (heard) await send(heard, 'voice');
  }

  // Kept current each render, so the recorder's cut-off always reaches this render's sendClip.
  useEffect(() => { clipHandler.current = (clip) => { void sendClip(clip); }; });

  async function startOver() {
    stopSpeaking();
    setSpeaking(false);
    try {
      await api.del('/api/assistant/thread');
      setTurns([]);
      setPending(null);
      setProblem(null);
    } catch (e) {
      fail(e, 'Could not clear the conversation.');
    }
  }

  const empty = !loading && turns.length === 0;
  const canSend = !busy && !recorder.recording && input.trim().length > 0;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.page }} edges={['left', 'right', 'bottom']}>
      <OfflineBanner />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2] }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <Switch
              accessibilityLabel="Read replies aloud"
              value={readAloud}
              onValueChange={(on) => { setReadAloud(on); if (!on) { stopSpeaking(); setSpeaking(false); } }}
              trackColor={{ true: c.accentDeep, false: c.control }}
            />
            <Txt step="label" tone="muted">Read replies aloud</Txt>
          </View>
          {speaking && (
            <Pressable accessibilityRole="button" accessibilityLabel="Stop speaking"
                       onPress={() => { stopSpeaking(); setSpeaking(false); }}
                       style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3] }}>
              <Txt step="label" weight="semibold">Stop</Txt>
            </Pressable>
          )}
          {turns.length > 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Start over" onPress={startOver}
                       style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: space[3] }}>
              <Txt step="label" tone="muted">Start over</Txt>
            </Pressable>
          )}
        </View>

        {/* Inverted: the newest turn sits at the bottom without scrolling to it. */}
        <FlatList
          inverted
          data={[...turns].reverse()}
          keyExtractor={(t) => t.id}
          renderItem={({ item }) => <Bubble turn={item} />}
          contentContainerStyle={{ padding: space[4], gap: space[3] }}
          ListHeaderComponent={
            <View style={{ gap: space[3] }}>
              {problem && <Notice>{problem}</Notice>}
              {busy && <Meta>{recorder.recording ? 'Listening…' : 'Thinking…'}</Meta>}
              {recorder.recording && <Meta tone="positive">Listening — tap the microphone when you are done</Meta>}
              {pending && (
                <Card tone="ok">
                  <Meta tone="positive">Waiting for your yes</Meta>
                  <Txt step="body" weight="semibold" style={{ marginTop: space[2] }}>{pending.summary}</Txt>
                  <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[4] }}>
                    <Button grow onPress={() => decide('confirm')} busy={busy}>Yes, do it</Button>
                    <Button grow kind="ghost" onPress={() => decide('cancel')} disabled={busy}>No</Button>
                  </View>
                </Card>
              )}
            </View>
          }
          ListFooterComponent={empty ? (
            <View style={{ gap: space[3], paddingVertical: space[5] }}>
              <Txt step="title" weight="semibold" accessibilityRole="header">Ask me about your cars</Txt>
              <Txt tone="muted">
                I can see all your cars, their warnings, costs, bookings and service history. Ask by typing, or tap the
                microphone and talk — in English or Hindi.
              </Txt>
              <View style={{ gap: space[2], marginTop: space[2] }}>
                {SUGGESTIONS.map((s) => <Button key={s} kind="ghost" onPress={() => send(s)}>{s}</Button>)}
              </View>
            </View>
          ) : undefined}
        />

        <View style={{ borderTopWidth: 1, borderTopColor: c.border, padding: space[3], backgroundColor: c.page }}>
          <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recorder.recording ? 'Stop and send' : 'Talk to the assistant'}
              accessibilityState={{ disabled: busy && !recorder.recording }}
              disabled={busy && !recorder.recording}
              onPress={toggleMic}
              android_ripple={{ color: c.insetStrong, foreground: true }}
              style={{ overflow: 'hidden', width: 52, minHeight: 48, borderRadius: radius.card, alignItems: 'center', justifyContent: 'center',
                       backgroundColor: recorder.recording ? c.accentDeep : c.card, borderWidth: 1,
                       borderColor: recorder.recording ? c.accentDeep : c.borderStrong }}
            >
              <Txt step="title" tone={recorder.recording ? 'onAccent' : 'fg'}>{recorder.recording ? '■' : '🎤'}</Txt>
            </Pressable>
            <TextInput
              accessibilityLabel="Message"
              value={input}
              onChangeText={setInput}
              editable={!busy && !recorder.recording}
              onSubmitEditing={() => send(input)}
              placeholder={recorder.recording ? 'Listening…' : 'Ask anything about your cars…'}
              placeholderTextColor={c.fgSubtle}
              maxFontSizeMultiplier={1.8}
              style={{ flex: 1, minHeight: 48, borderRadius: radius.card, borderWidth: 1, borderColor: c.borderStrong,
                       backgroundColor: c.card, paddingHorizontal: space[4], color: c.fg, fontFamily: fonts.regular, ...type.body }}
            />
            <Pressable accessibilityRole="button" accessibilityLabel="Send" accessibilityState={{ disabled: !canSend }}
                       disabled={!canSend} onPress={() => send(input)}
                       android_ripple={{ color: c.accentInk, foreground: true }}
                       style={{ overflow: 'hidden', minWidth: 56, minHeight: 48, borderRadius: radius.card, alignItems: 'center',
                                justifyContent: 'center', backgroundColor: canSend ? c.accentDeep : c.control }}>
              <Txt step="body" weight="semibold" tone={canSend ? 'onAccent' : 'subtle'}>Send</Txt>
            </Pressable>
          </View>
          <Pressable accessibilityRole="button" onPress={() => router.back()} style={{ alignSelf: 'center', paddingTop: space[2], minHeight: 32 }}>
            <Txt step="label" tone="subtle">Back to my car</Txt>
          </Pressable>
        </View>
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
        accessibilityLabel={`${mine ? 'You' : 'Assistant'}: ${turn.text}`}
        style={{
          maxWidth: '86%', paddingHorizontal: space[4], paddingVertical: space[3], borderRadius: radius.panel,
          borderBottomRightRadius: mine ? 5 : radius.panel, borderBottomLeftRadius: mine ? radius.panel : 5,
          backgroundColor: mine ? c.accentDeep : c.card, borderWidth: mine ? 0 : 1, borderColor: c.border,
        }}
      >
        <Txt step="body" tone={mine ? 'onAccent' : 'fg'}>{turn.text}</Txt>
      </View>
    </View>
  );
}
