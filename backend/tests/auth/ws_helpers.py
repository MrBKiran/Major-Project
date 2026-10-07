"""WebSocket test helpers, shared by the suites that exercise /ws/events."""

from __future__ import annotations

import queue
import threading

import pytest
from starlette.websockets import WebSocketDisconnect

UNAUTHENTICATED, FORBIDDEN = 4401, 4403


def recv(ws, seconds: float = 5.0):
    """ws.receive_json() with a deadline.

    A server that never closes would otherwise hang the whole suite instead of
    failing one test, and pytest has no timeout plugin installed here.
    """
    out: queue.Queue = queue.Queue()

    def _run():
        try:
            out.put(("frame", ws.receive_json()))
        except BaseException as exc:  # noqa: BLE001 — handed back to the caller
            out.put(("error", exc))

    threading.Thread(target=_run, daemon=True).start()
    try:
        kind, value = out.get(timeout=seconds)
    except queue.Empty:
        pytest.fail(f"neither a frame nor a close arrived within {seconds}s")
    if kind == "error":
        raise value
    return value


def connect(client):
    return client.websocket_connect("/ws/events")


def close_code(client, first_message=None, *, raw: str | None = None) -> int:
    """Connect, optionally send a first message, and return how the server ended it."""
    with connect(client) as ws:
        if raw is not None:
            ws.send_text(raw)
        elif first_message is not None:
            ws.send_json(first_message)
        with pytest.raises(WebSocketDisconnect) as closed:
            recv(ws)
    return closed.value.code


def auth_message(token: str) -> dict:
    return {"type": "auth", "token": token}
