"""Turning a voice note into text, with Groq's hosted Whisper.

The phone records, the server transcribes: that keeps the app small, gives the same
result on every device, and handles Hindi and Hinglish, which the phones' own
recognisers are patchy on. Replies are NOT synthesised here — the phone reads them
aloud with its own voice, so a reply costs no server audio at all.
"""

from __future__ import annotations

import httpx
from fastapi import HTTPException

from app.config import settings

GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
# A spoken question is seconds long. This bounds what a client can make us upload to Groq.
MAX_AUDIO_BYTES = 4 * 1024 * 1024
# Whisper invents words from silence and noise. Its own confidence figures are the tell:
# a stretch it was unsure of (low average log-probability, or a suspiciously repetitive
# transcript) is dropped, and so are the stock phrases it produces from nothing at all.
# Groq reports a no-speech probability of 0 for pure silence, so that figure is not relied on.
MIN_CONFIDENCE = -1.0
MAX_COMPRESSION = 2.4
PHANTOMS = {"thank you", "thank you.", "thanks for watching", "thanks for watching.",
            "thank you for watching", "thank you for watching.", "you", "you.", "bye", "bye."}
ALLOWED_TYPES = ("audio/", "video/mp4", "application/octet-stream")
# Whisper reads this as preceding context: it biases spelling toward these, which is the
# difference between "Thar Roxx" and "tar rocks".
VOCAB_HINT = ("AutoSaarthi, brake pads, water pump, oil pump, battery, coolant, tyre pressure, "
              "Bolero, Thar, Thar Roxx, Scorpio, XUV300, service booking.")


async def transcribe(audio: bytes, filename: str, content_type: str, *, language: str | None = None,
                     client: httpx.AsyncClient | None = None) -> dict:
    if not audio:
        raise HTTPException(422, "no audio received")
    if len(audio) > MAX_AUDIO_BYTES:
        raise HTTPException(413, "that recording is too long; keep it to a short question")
    if not content_type.startswith(ALLOWED_TYPES):
        raise HTTPException(415, "send an audio recording")
    if not settings.groq_api_key:
        raise HTTPException(503, "voice is not set up on this server")

    data = {"model": settings.stt_model, "response_format": "verbose_json", "temperature": "0", "prompt": VOCAB_HINT}
    if language and language.isalpha() and len(language) == 2:
        data["language"] = language.lower()
    files = {"file": (filename or "voice.m4a", audio, content_type or "audio/mp4")}
    own = client is None
    client = client or httpx.AsyncClient(timeout=20.0)
    try:
        resp = await client.post(GROQ_TRANSCRIBE_URL, data=data, files=files,
                                 headers={"Authorization": f"Bearer {settings.groq_api_key}"})
    except httpx.HTTPError as exc:
        raise HTTPException(503, "could not reach the speech service; try again or type it") from exc
    finally:
        if own:
            await client.aclose()

    if resp.status_code == 429:
        raise HTTPException(503, "the speech service is busy; try again in a moment")
    if resp.status_code >= 400:
        raise HTTPException(502, "the speech service could not read that recording")
    body = resp.json()
    segments = body.get("segments")
    if segments is None:
        return {"text": (body.get("text") or "").strip()}
    spoken = [seg.get("text", "") for seg in segments
              if (seg.get("avg_logprob") or 0) >= MIN_CONFIDENCE and (seg.get("compression_ratio") or 0) <= MAX_COMPRESSION]
    text = "".join(spoken).strip()
    return {"text": "" if text.lower() in PHANTOMS else text}
