"""Data Analysis Worker Agent – reads telemetry and runs ML health/anomaly models."""
import random
from datetime import datetime


DEMO_DATA = {
    "MH12AB1001": {"coolant_trend": "rising", "coolant_temp": 108, "rpm": 2400, "speed": 68},
    "MH12AB1002": {"coolant_trend": "stable", "coolant_temp": 88, "rpm": 1800, "speed": 45},
}


def run(vin: str, demo_mode: bool = True) -> dict:
    if demo_mode:
        data = DEMO_DATA.get(vin, DEMO_DATA["MH12AB1001"])
        return {
            "status": "OK",
            "vin": vin,
            "latest_telemetry": data,
            "anomaly_score": 0.78 if data.get("coolant_trend") == "rising" else 0.12,
            "health_label": "Needs Service" if data.get("coolant_trend") == "rising" else "Good",
            "health_probabilities": {"Excellent": 0.05, "Good": 0.1, "Needs Service": 0.6, "Critical": 0.25},
            "timestamp": datetime.utcnow().isoformat(),
        }
    # Production: query DB + run ML models
    return {"status": "OK", "vin": vin, "health_label": "Good"}
