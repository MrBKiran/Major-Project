"""
Typed event bus. One stream feeds the agent-trace graph, the security console,
and the toasts. If it isn't emitted here, the judge can't see it happen.
"""

from __future__ import annotations

import asyncio
import time
from collections import deque
from typing import Any

MAX_BUFFER = 2000


class EventBus:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()
        self._buffer: deque[dict] = deque(maxlen=MAX_BUFFER)
        self._seq = 0

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def replay(self, n: int = 200) -> list[dict]:
        return list(self._buffer)[-n:]

    async def emit(self, event: dict[str, Any]) -> None:
        self._seq += 1
        event = {"seq": self._seq, "ts": event.get("ts", time.time()), **event}
        self._buffer.append(event)
        for q in list(self._subs):
            try:
                q.put_nowait(event)
            except asyncio.QueueFull:
                self._subs.discard(q)

    def emit_nowait(self, event: dict[str, Any]) -> None:
        try:
            asyncio.get_running_loop().create_task(self.emit(event))
        except RuntimeError:
            self._buffer.append(event)


bus = EventBus()
