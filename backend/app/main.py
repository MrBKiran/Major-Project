from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio

from app.api import vehicles, telemetry, predictions, appointments, agents, ueba, rca, ws, chat
from app.mqtt.client import start_mqtt

@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(start_mqtt())
    yield

app = FastAPI(
    title="AutoSaarthi API",
    description="Agentic AI Automotive Predictive Maintenance Platform",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(vehicles.router, prefix="/api/vehicles", tags=["vehicles"])
app.include_router(telemetry.router, prefix="/api/telemetry", tags=["telemetry"])
app.include_router(predictions.router, prefix="/api/predictions", tags=["predictions"])
app.include_router(appointments.router, prefix="/api/appointments", tags=["appointments"])
app.include_router(agents.router, prefix="/api/agents", tags=["agents"])
app.include_router(ueba.router, prefix="/api/ueba", tags=["ueba"])
app.include_router(rca.router, prefix="/api/rca", tags=["rca"])
app.include_router(chat.router, prefix="/api/chat", tags=["chat"])
app.include_router(ws.router, tags=["websocket"])

@app.get("/")
async def root():
    return {"status": "AutoSaarthi running", "version": "1.0.0"}

@app.get("/health")
async def health():
    return {"status": "ok"}
