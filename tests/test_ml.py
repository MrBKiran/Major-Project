"""Tests for ML models"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

def test_ml_health():
    from app.ml.models import ml_service
    result = ml_service.predict_health({
        "coolant_temp": 108, "oil_pressure": 30,
        "battery_voltage": 12.4, "engine_load": 60,
        "rpm": 2200, "speed": 50, "fuel_level": 60, "dtc": ["P0217"]
    })
    assert "class" in result
    assert "probabilities" in result

def test_anomaly():
    from app.ml.models import ml_service
    score = ml_service.anomaly_score([0]*8)
    assert 0.0 <= score <= 1.0

def test_failure_prediction():
    from app.ml.models import ml_service
    result = ml_service.predict_failure({
        "coolant_temp_trend": 3.0, "oil_pressure_trend": -0.5,
        "battery_trend": 0.0, "coolant_temp_max": 108,
        "oil_pressure_min": 28, "dtc_count_7d": 3,
        "age_days": 900, "km_since_service": 8000
    })
    assert "failure_probability" in result
    assert result["severity"] in ("P1", "P2", "P3")
