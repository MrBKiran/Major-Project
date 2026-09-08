from fastapi import APIRouter
from app.ml.models import ml_service
from app.simulators import generate_demo_telemetry

router = APIRouter()

@router.get("/{vin}")
async def predict(vin: str):
    telem = generate_demo_telemetry(vin)
    health = ml_service.predict_health(telem)
    features = {
        "coolant_temp_trend": telem.get("coolant_temp", 90) - 88,
        "oil_pressure_trend": -0.1,
        "battery_trend": -0.005,
        "coolant_temp_max": telem.get("coolant_temp", 90),
        "oil_pressure_min": telem.get("oil_pressure", 32),
        "dtc_count_7d": len(telem.get("dtc", [])),
        "age_days": 800,
        "km_since_service": 4500,
    }
    failure = ml_service.predict_failure(features)
    return {"vin": vin, "health": health, "failure": failure, "telemetry": telem}
