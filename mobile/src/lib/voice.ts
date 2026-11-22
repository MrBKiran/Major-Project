/**
 * The assistant's ears and mouth.
 *
 * Hearing: the phone records a short clip and the SERVER turns it into text
 * (POST /api/assistant/transcribe), so Hindi and Hinglish work the same on every
 * phone. Speaking: the reply is read aloud with the phone's own voice, so a reply costs
 * no audio download.
 *
 * The two native modules are imported here and nowhere else, so screens and their tests
 * deal in plain functions.
 */

import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';

/** A clip longer than this is cut off: a question is seconds, and the server caps the upload. */
export const MAX_CLIP_MS = 30_000;

export interface Clip { uri: string; name: string; type: string }

export type Recorder = {
  recording: boolean;
  /** Ask for the microphone if needed, then start. Resolves false if the owner said no. */
  start(): Promise<boolean>;
  /** Stop and return the clip, or null if nothing was recording. */
  stop(): Promise<Clip | null>;
};

/**
 * `onLimit` receives the clip when the recording is cut off at MAX_CLIP_MS. Without it the cut-off
 * clip would be dropped with nothing shown, because the screen only collects a clip when the owner
 * taps stop. It is held in a ref so the timer always calls the latest one.
 */
export function useRecorder(onLimit?: (clip: Clip | null) => void): Recorder {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const cutoff = useRef<ReturnType<typeof setTimeout> | null>(null);
  const limitHandler = useRef(onLimit);
  useEffect(() => { limitHandler.current = onLimit; }, [onLimit]);

  const stop = useCallback(async (): Promise<Clip | null> => {
    if (cutoff.current) clearTimeout(cutoff.current);
    cutoff.current = null;
    if (!recorder.isRecording) { setRecording(false); return null; }
    try {
      await recorder.stop();
    } finally {
      setRecording(false);
      await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    }
    return recorder.uri ? { uri: recorder.uri, name: 'voice.m4a', type: 'audio/mp4' } : null;
  }, [recorder]);

  const start = useCallback(async (): Promise<boolean> => {
    const { granted } = await AudioModule.requestRecordingPermissionsAsync();
    if (!granted) return false;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    setRecording(true);
    cutoff.current = setTimeout(() => { void stop().then((clip) => limitHandler.current?.(clip)); }, MAX_CLIP_MS);
    return true;
  }, [recorder, stop]);

  useEffect(() => () => { if (cutoff.current) clearTimeout(cutoff.current); }, []);

  return { recording, start, stop };
}

/** Hindi when the reply is mostly Devanagari, India English otherwise. */
export function languageOf(text: string): string {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  return devanagari > text.replace(/\s/g, '').length / 4 ? 'hi-IN' : 'en-IN';
}

export function speak(text: string, onDone?: () => void): void {
  Speech.stop();
  Speech.speak(text, { language: languageOf(text), rate: 0.98, onDone, onStopped: onDone, onError: onDone });
}

export function stopSpeaking(): void {
  void Speech.stop();
}
