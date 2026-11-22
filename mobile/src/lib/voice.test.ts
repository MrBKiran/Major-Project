/**
 * The recorder's own behaviour, with the native audio module stood in for: what the screen tests
 * replace wholesale. The part that matters is the length limit — a long recording must not be
 * dropped silently.
 */

import { act, renderHook } from '@testing-library/react-native';

import { languageOf, MAX_CLIP_MS, useRecorder } from './voice';

const mockRecorder = {
  isRecording: false,
  uri: 'file:///clip.m4a' as string | null,
  prepareToRecordAsync: jest.fn(async () => undefined),
  record: jest.fn(() => { mockRecorder.isRecording = true; }),
  stop: jest.fn(async () => { mockRecorder.isRecording = false; }),
};
const mockPermission = jest.fn(async () => ({ granted: true }));

jest.mock('expo-audio', () => ({
  useAudioRecorder: () => mockRecorder,
  RecordingPresets: { HIGH_QUALITY: {} },
  setAudioModeAsync: jest.fn(async () => undefined),
  AudioModule: { requestRecordingPermissionsAsync: () => mockPermission() },
}));
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));

beforeEach(() => {
  jest.useFakeTimers();
  mockRecorder.isRecording = false;
  mockRecorder.uri = 'file:///clip.m4a';
  mockPermission.mockResolvedValue({ granted: true });
  mockRecorder.prepareToRecordAsync.mockClear();
  mockRecorder.record.mockClear();
  mockRecorder.stop.mockClear();
});
afterEach(() => jest.useRealTimers());

const CLIP = { uri: 'file:///clip.m4a', name: 'voice.m4a', type: 'audio/mp4' };

it('hands the clip over when the recording reaches the length limit', async () => {
  const onLimit = jest.fn();
  const { result } = await renderHook(() => useRecorder(onLimit));
  await act(async () => { expect(await result.current.start()).toBe(true); });
  expect(result.current.recording).toBe(true);

  await act(async () => { jest.advanceTimersByTime(MAX_CLIP_MS - 1); });
  expect(onLimit).not.toHaveBeenCalled();

  await act(async () => { jest.advanceTimersByTime(1); });
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
  expect(onLimit).toHaveBeenCalledWith(CLIP);
  expect(result.current.recording).toBe(false);
});

it('does not cut off a recording the owner already stopped', async () => {
  const onLimit = jest.fn();
  const { result } = await renderHook(() => useRecorder(onLimit));
  await act(async () => { await result.current.start(); });
  let clip: unknown;
  await act(async () => { clip = await result.current.stop(); });
  expect(clip).toEqual(CLIP);

  await act(async () => { jest.advanceTimersByTime(MAX_CLIP_MS * 2); });
  expect(onLimit).not.toHaveBeenCalled();
  expect(mockRecorder.stop).toHaveBeenCalledTimes(1);
});

it('does not start, or set a timer, when the microphone is not allowed', async () => {
  mockPermission.mockResolvedValue({ granted: false });
  const onLimit = jest.fn();
  const { result } = await renderHook(() => useRecorder(onLimit));
  await act(async () => { expect(await result.current.start()).toBe(false); });
  expect(mockRecorder.record).not.toHaveBeenCalled();
  await act(async () => { jest.advanceTimersByTime(MAX_CLIP_MS * 2); });
  expect(onLimit).not.toHaveBeenCalled();
});

it('calls the latest handler, not the one from when recording began', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const { result, rerender } = await renderHook((p: { on: () => void }) => useRecorder(p.on), { initialProps: { on: first } });
  await act(async () => { await result.current.start(); });
  await rerender({ on: second });
  await act(async () => { jest.advanceTimersByTime(MAX_CLIP_MS); });
  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it('reads Hindi replies in Hindi and everything else in Indian English', () => {
  expect(languageOf('आपकी गाड़ी ठीक है')).toBe('hi-IN');
  expect(languageOf('Your Bolero is fine.')).toBe('en-IN');
  expect(languageOf('Aapki gaadi theek hai')).toBe('en-IN');
});
