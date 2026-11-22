"""The owner's assistant over HTTP: type or speak, and confirm what it proposes.

  GET    /api/assistant/thread                 the conversation so far, and anything waiting for a yes
  POST   /api/assistant/message                one turn (text, or the transcript of a voice note)
  POST   /api/assistant/transcribe             a voice recording in, text out
  POST   /api/assistant/actions/{id}/confirm   run a proposal the owner agreed to
  POST   /api/assistant/actions/{id}/cancel    drop it
  DELETE /api/assistant/thread                 forget the conversation and its memory

Logic in app/assistant/. The model can read the owner's garage and PROPOSE a booking;
only /confirm (or a plain spoken yes inside /message) ever runs one.
"""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel, Field

from app.assistant import service, speech, store
from app.assistant.llm import ChatModel, chat_step
from app.auth.deps import requires
from app.auth.principal import Principal
from app.auth.ratelimit import check_principal

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


def get_chat_model() -> ChatModel:
    """FastAPI dependency. Tests replace it with a scripted model."""
    return chat_step


def _throttle(principal: Principal) -> None:
    allowed, retry_after = check_principal(principal.user_id, heavy=True)
    if not allowed:
        raise HTTPException(429, f"slow down a little, try again in {retry_after}s",
                            headers={"Retry-After": str(retry_after)})


class MessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=service.MAX_MESSAGE)
    channel: Literal["text", "voice"] = "text"
    vin: str | None = Field(default=None, max_length=17)


@router.get("/thread")
async def get_thread(principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    pid = principal.user_id
    turns, pending = await asyncio.gather(asyncio.to_thread(store.thread, pid),
                                          asyncio.to_thread(store.pending_action, pid))
    return {"turns": turns, "pending_action": pending}


@router.post("/message")
async def post_message(req: MessageRequest, background: BackgroundTasks,
                       principal: Principal = Depends(requires("vehicle:read")),
                       model: ChatModel = Depends(get_chat_model)) -> dict:
    _throttle(principal)
    out = await service.converse(principal, req.message, channel=req.channel, vin=req.vin, model=model)
    if not out.get("blocked"):
        background.add_task(service.maybe_summarise, principal.user_id, model)
    return out


@router.post("/transcribe")
async def post_transcribe(audio: UploadFile = File(...), language: str | None = Form(default=None),
                          principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    _throttle(principal)
    data = await audio.read(speech.MAX_AUDIO_BYTES + 1)
    return await speech.transcribe(data, audio.filename or "voice.m4a",
                                   audio.content_type or "application/octet-stream", language=language)


@router.post("/actions/{action_id}/confirm")
async def confirm_action(action_id: str, principal: Principal = Depends(requires("appointment:write"))) -> dict:
    result = await service.execute_action(principal, action_id)
    pid = principal.user_id
    if result.get("ok"):
        # Both halves of the exchange go in the thread, so the thread reads as it happened.
        await asyncio.to_thread(store.add_message, pid, "user", "Yes, go ahead.", channel="tap")
        await asyncio.to_thread(store.add_message, pid, "assistant", result["message"], channel="action")
    elif result.get("message"):
        # Nothing ran (expired, already done, or the booking failed). The owner is told why, but the
        # thread must not show them agreeing to something that did not happen: later turns replay it.
        await asyncio.to_thread(store.add_message, pid, "assistant", result["message"], channel="action")
    return result


@router.post("/actions/{action_id}/cancel")
async def cancel_action(action_id: str, principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    result = await service.refuse_action(principal, action_id)
    if result["ok"]:
        pid = principal.user_id
        await asyncio.to_thread(store.add_message, pid, "user", "No, leave it.", channel="tap")
        await asyncio.to_thread(store.add_message, pid, "assistant", result["message"], channel="action")
    return result


@router.delete("/thread")
async def clear_thread(principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    await asyncio.to_thread(store.clear, principal.user_id)
    return {"cleared": True}
