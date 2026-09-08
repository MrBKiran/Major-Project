"""
AutoSaarthi ML Inference
Loads trained models and runs predictions on telemetry data.
"""
import joblib
import numpy as np
import pandas as pd
from pathlib import Path
from typing import Optional

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"

_models = {}


def _load(name: str):
    if name not in _models:
        path = MODEL_DIR / f"{name}.pkl"
        if path.exists():
            _models[name] = joblib.load(path)
        else:
            return None
    return _models.get(name)


FEATURE_COLS = [
    "coolant_temp", "oil_pressure", "rpm", "speed",
    "battery_voltage", "fuel_level", "coolant_temp_trend_7d",
    "mileage", "dtc_count"
]

HEALTH_LABELS = ["Excellent", "Good", "Needs Service", "Critical"]


def predict_health(telemetry: dict) -> dict:
    model = _load("m1_health_classifier")
    if not model:
        return {"health_label": "Good", "probabilities": {}, "source": "demo"}
    X = pd.DataFrame([{col: telemetry.get(col, 0) for col in FEATURE_COLS}])
    proba = model.predict_proba(X)[0]
    label_idx = int(np.argmax(proba))
    return {
        "health_label": HEALTH_LABELS[label_idx],
        "probabilities": {HEALTH_LABELS[i]: float(p) for i, p in enumerate(proba)},
        "source": "model",
    }


def predict_failure(telemetry: dict) -> dict:
    model = _load("m2_failure_predictor")
    if not model:
        return {"failure_probability": 0.5, "component": "Water Pump", "source": "demo"}
    X = pd.DataFrame([{col: telemetry.get(col, 0) for col in FEATURE_COLS}])
    proba = model.predict_proba(X)[0][1]
    days = max(1, int((1 - proba) * 30))
    return {
        "failure_probability": float(proba),
        "component": "Water Pump" if proba > 0.5 else "None",
        "days_to_failure": days,
        "source": "model",
    }


def detect_anomaly(telemetry: dict) -> dict:
    model = _load("m4_anomaly_detector")
    if not model:
        return {"is_anomaly": False, "score": 0.0, "source": "demo"}
    features = ["coolant_temp", "oil_pressure", "rpm", "speed", "battery_voltage"]
    X = pd.DataFrame([{col: telemetry.get(col, 0) for col in features}])
    score = model.decision_function(X)[0]
    is_anomaly = model.predict(X)[0] == -1
    return {
        "is_anomaly": bool(is_anomaly),
        "anomaly_score": float(-score),
        "source": "model",
    }
