"""
AutoSaarthi – FastAPI Backend Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio

from api.routes import vehicles, telemetry, predictions, appointments, agents, ueba, rca
from api.websocket_manager import ws_manager
from mqtt.client import MQTTClient
from utils.db import init_db
from utils.config import settings

mqtt_client: MQTTClient | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle."""
    global mqtt_client
    await init_db()
    mqtt_client = MQTTClient(settings.MQTT_HOST, settings.MQTT_PORT)
    asyncio.create_task(mqtt_client.start())
    print("✅ AutoSaarthi backend started")
    yield
    if mqtt_client:
        await mqtt_client.stop()
    print("👋 AutoSaarthi backend stopped")


app = FastAPI(
    title="AutoSaarthi API",
    description="Agentic AI Vehicle Maintenance Platform",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Routers ──────────────────────────────────────────
app.include_router(vehicles.router,     prefix="/api/vehicles",     tags=["Vehicles"])
app.include_router(telemetry.router,    prefix="/api/telemetry",    tags=["Telemetry"])
app.include_router(predictions.router,  prefix="/api/predictions",  tags=["Predictions"])
app.include_router(appointments.router, prefix="/api/appointments", tags=["Appointments"])
app.include_router(agents.router,       prefix="/api/agents",       tags=["Agents"])
app.include_router(ueba.router,         prefix="/api/ueba",         tags=["UEBA Security"])
app.include_router(rca.router,          prefix="/api/rca",          tags=["RCA/CAPA"])

# ─── WebSocket ────────────────────────────────────────
from fastapi import WebSocket, WebSocketDisconnect

@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await ws_manager.connect(websocket, client_id)
    try:
        while True:
            data = await websocket.receive_text()
            await ws_manager.handle_message(client_id, data)
    except WebSocketDisconnect:
        ws_manager.disconnect(client_id)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "AutoSaarthi"}
