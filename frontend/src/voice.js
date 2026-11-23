/**
 * The assistant's ears and mouth, in the browser.
 *
 * Hearing: record a short clip with the microphone and let the SERVER turn it into text
 * (POST /api/assistant/transcribe), so Hindi and Hinglish work the same in every browser.
 * Speaking: read the reply aloud with the browser's own voice, so a reply costs no audio download.
 *
 * Both need a secure page (https, or localhost) and the owner's say-so for the microphone;
 * `micAvailable` / `speechAvailable` let the screen offer only what can work.
 */

import { useCallback, useEffect, useRef, useState } from "react";

/** A clip longer than this is cut off and sent as it is: a question is seconds, and the server caps the upload. */
export const MAX_CLIP_MS = 30_000;

const MIME_PREFERENCE = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function micAvailable() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia)
    && typeof MediaRecorder !== "undefined";
}

export function speechAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";
}

/** Groq reads the container from the file name, so name it for what the browser actually recorded. */
export function clipName(mimeType = "") {
  if (mimeType.includes("mp4")) return "voice.m4a";
  if (mimeType.includes("ogg")) return "voice.ogg";
  return "voice.webm";
}

function pickMime() {
  return MIME_PREFERENCE.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? "";
}

/**
 * `start()` resolves "ok", "denied" (the owner said no), "unsupported" or "error".
 * `stop()` resolves the clip, `{ blob, name }`, or null if nothing was recording.
 * `onLimit(clip)` receives the clip when the recording is cut off at MAX_CLIP_MS: without it a
 * long question would be dropped with nothing shown.
 */
export function useRecorder(onLimit) {
  const [recording, setRecording] = useState(false);
  const session = useRef(null);
  const timer = useRef(null);
  const limitHandler = useRef(onLimit);
  useEffect(() => { limitHandler.current = onLimit; }, [onLimit]);

  const release = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    session.current?.stream.getTracks().forEach((t) => t.stop());
    session.current = null;
    setRecording(false);
  }, []);

  const stop = useCallback(() => new Promise((resolve) => {
    const s = session.current;
    if (!s || s.recorder.state === "inactive") { release(); resolve(null); return; }
    s.recorder.onstop = () => {
      const blob = new Blob(s.chunks, { type: s.recorder.mimeType || s.mime || "audio/webm" });
      release();
      resolve(blob.size ? { blob, name: clipName(blob.type) } : null);
    };
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    s.recorder.stop();
  }), [release]);

  const start = useCallback(async () => {
    if (!micAvailable()) return "unsupported";
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return e?.name === "NotAllowedError" || e?.name === "SecurityError" ? "denied" : "error";
    }
    try {
      const mime = pickMime();
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
      session.current = { recorder, stream, chunks, mime };
      recorder.start();
      setRecording(true);
      timer.current = setTimeout(() => { void stop().then((clip) => limitHandler.current?.(clip)); }, MAX_CLIP_MS);
      return "ok";
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      return "error";
    }
  }, [stop]);

  // Leaving the screen must not leave the microphone on.
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    const s = session.current;
    if (s) {
      s.recorder.onstop = null;
      if (s.recorder.state !== "inactive") s.recorder.stop();
      s.stream.getTracks().forEach((t) => t.stop());
    }
  }, []);

  return { recording, start, stop };
}

/** Hindi when the reply is mostly Devanagari, Indian English otherwise. */
export function languageOf(text) {
  const devanagari = (text.match(/[ऀ-ॿ]/g) ?? []).length;
  return devanagari > text.replace(/\s/g, "").length / 4 ? "hi-IN" : "en-IN";
}

export function speak(text, onDone) {
  if (!speechAvailable()) { onDone?.(); return; }
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = languageOf(text);
  u.rate = 0.98;
  u.onend = () => onDone?.();
  u.onerror = () => onDone?.();
  window.speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if (speechAvailable()) window.speechSynthesis.cancel();
}
