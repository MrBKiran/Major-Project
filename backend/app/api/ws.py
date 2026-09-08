from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio, json
from app.simulators import generate_demo_telemetry, PERSONAS

router = APIRouter()
connections: list[WebSocket] = []

@router.websocket("/ws/telemetry")
async def telemetry_ws(websocket: WebSocket):
    await websocket.accept()
    connections.append(websocket)
    vins = list(PERSONAS.keys())
    try:
        while True:
            for vin in vins:
                data = generate_demo_telemetry(vin)
                await websocket.send_text(json.dumps(data))
            await asyncio.sleep(2)
    except WebSocketDisconnect:
        connections.remove(websocket)
