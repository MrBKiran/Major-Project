/**
 * The browser recorder, with the microphone and MediaRecorder stood in for. The part that matters is
 * the length limit (a long recording must not be dropped silently) and that the microphone is let go
 * of: a page that leaves it on shows the browser's recording indicator after the owner has left.
 */

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clipName, languageOf, MAX_CLIP_MS, micAvailable, useRecorder } from "./voice.js";

const track = { stop: vi.fn() };
const stream = { getTracks: () => [track] };
let recorders;

class FakeRecorder {
  static isTypeSupported = (m) => m === "audio/webm;codecs=opus";

  constructor(_stream, options) {
    this.mimeType = options?.mimeType ?? "";
    this.state = "inactive";
    recorders.push(this);
  }

  start() { this.state = "recording"; }

  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["spoken"], { type: this.mimeType }) });
    this.onstop?.();
  }
}

beforeEach(() => {
  recorders = [];
  track.stop.mockClear();
  vi.useFakeTimers();
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn(async () => stream) } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("recording", () => {
  it("records in a format Whisper reads, and hands back the clip on stop", async () => {
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.start()).toBe("ok"); });
    expect(result.current.recording).toBe(true);
    expect(recorders[0].mimeType).toBe("audio/webm;codecs=opus");

    let clip;
    await act(async () => { clip = await result.current.stop(); });
    expect(clip.name).toBe("voice.webm");
    expect(clip.blob.size).toBeGreaterThan(0);
    expect(result.current.recording).toBe(false);
    expect(track.stop).toHaveBeenCalled();                 // the microphone is let go of
  });

  it("hands the clip over when the recording reaches the length limit", async () => {
    const onLimit = vi.fn();
    const { result } = renderHook(() => useRecorder(onLimit));
    await act(async () => { await result.current.start(); });

    await act(async () => { vi.advanceTimersByTime(MAX_CLIP_MS - 1); });
    expect(onLimit).not.toHaveBeenCalled();

    await act(async () => { vi.advanceTimersByTime(1); });
    expect(onLimit).toHaveBeenCalledTimes(1);
    expect(onLimit.mock.calls[0][0].name).toBe("voice.webm");
    expect(result.current.recording).toBe(false);
  });

  it("does not cut off a recording the owner already stopped", async () => {
    const onLimit = vi.fn();
    const { result } = renderHook(() => useRecorder(onLimit));
    await act(async () => { await result.current.start(); });
    await act(async () => { await result.current.stop(); });
    await act(async () => { vi.advanceTimersByTime(MAX_CLIP_MS * 2); });
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("calls the latest handler, not the one from when recording began", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { result, rerender } = renderHook(({ on }) => useRecorder(on), { initialProps: { on: first } });
    await act(async () => { await result.current.start(); });
    rerender({ on: second });
    await act(async () => { vi.advanceTimersByTime(MAX_CLIP_MS); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("lets go of the microphone when the screen is left mid-recording", async () => {
    const { result, unmount } = renderHook(() => useRecorder());
    await act(async () => { await result.current.start(); });
    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(recorders[0].state).toBe("inactive");
  });
});

describe("when it cannot record", () => {
  it("says denied when the owner refuses the microphone", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.start()).toBe("denied"); });
    expect(result.current.recording).toBe(false);
  });

  it("says error for any other microphone failure, and sets no timer", async () => {
    navigator.mediaDevices.getUserMedia.mockRejectedValue(Object.assign(new Error("busy"), { name: "NotReadableError" }));
    const onLimit = vi.fn();
    const { result } = renderHook(() => useRecorder(onLimit));
    await act(async () => { expect(await result.current.start()).toBe("error"); });
    await act(async () => { vi.advanceTimersByTime(MAX_CLIP_MS * 2); });
    expect(onLimit).not.toHaveBeenCalled();
  });

  it("says unsupported in a browser with no MediaRecorder", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(micAvailable()).toBe(false);
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.start()).toBe("unsupported"); });
  });

  it("returns nothing from stop when nothing was recording", async () => {
    const { result } = renderHook(() => useRecorder());
    await act(async () => { expect(await result.current.stop()).toBeNull(); });
  });
});

describe("the small helpers", () => {
  it("names the clip for what the browser recorded, because the server reads the container from the name", () => {
    expect(clipName("audio/webm;codecs=opus")).toBe("voice.webm");
    expect(clipName("audio/mp4")).toBe("voice.m4a");
    expect(clipName("audio/ogg;codecs=opus")).toBe("voice.ogg");
    expect(clipName("")).toBe("voice.webm");
  });

  it("reads Hindi replies in Hindi and everything else in Indian English", () => {
    expect(languageOf("आपकी गाड़ी ठीक है")).toBe("hi-IN");
    expect(languageOf("Your Bolero is fine.")).toBe("en-IN");
    expect(languageOf("Aapki gaadi theek hai")).toBe("en-IN");
  });
});
