"""
WebSocket Manager – broadcasts telemetry and agent events to all connected clients.
"""
import json
from fastapi import WebSocket
from typing import Dict


class WebSocketManager:
    def __init__(self):
        self.active: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active[client_id] = websocket

    def disconnect(self, client_id: str):
        self.active.pop(client_id, None)

    async def broadcast(self, event_type: str, data: dict):
        message = json.dumps({"type": event_type, "data": data})
        disconnected = []
        for cid, ws in self.active.items():
            try:
                await ws.send_text(message)
            except Exception:
                disconnected.append(cid)
        for cid in disconnected:
            self.disconnect(cid)

    async def send_to(self, client_id: str, event_type: str, data: dict):
        ws = self.active.get(client_id)
        if ws:
            await ws.send_text(json.dumps({"type": event_type, "data": data}))

    async def handle_message(self, client_id: str, raw: str):
        try:
            msg = json.loads(raw)
            if msg.get("type") == "ping":
                await self.send_to(client_id, "pong", {})
        except Exception:
            pass


ws_manager = WebSocketManager()
