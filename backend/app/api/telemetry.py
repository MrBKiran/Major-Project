from fastapi import APIRouter
from app.mqtt.client import get_latest_telemetry
from app.simulators import generate_demo_telemetry

router = APIRouter()

@router.get("/{vin}/latest")
async def latest_telemetry(vin: str):
    data = get_latest_telemetry(vin, 1)
    if not data:
        data = [generate_demo_telemetry(vin)]
    return data[0]

@router.get("/{vin}/stream")
async def telemetry_stream(vin: str, n: int = 50):
    return [generate_demo_telemetry(vin) for _ in range(n)]
