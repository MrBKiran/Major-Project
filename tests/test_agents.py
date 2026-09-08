"""Basic smoke tests for AutoSaarthi agents and ML inference."""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

import pytest


def test_data_analysis_demo():
    from agents.workers.data_analysis import run
    result = run("MH12AB1001", demo_mode=True)
    assert result["status"] == "OK"
    assert "health_label" in result
    assert result["vin"] == "MH12AB1001"


def test_diagnosis_worker():
    from agents.workers.diagnosis import run
    da_result = {"health_label": "Needs Service"}
    result = run("MH12AB1001", da_result)
    assert result["status"] == "OK"
    assert result["failure_probability"] > 0.5


def test_scheduling_worker_booked():
    from agents.workers.scheduling import run
    ce_result = {"status": "BOOKED"}
    result = run("MH12AB1001", ce_result)
    assert result["status"] == "CONFIRMED"
    assert "slot" in result


def test_scheduling_worker_declined():
    from agents.workers.scheduling import run
    ce_result = {"status": "DECLINED"}
    result = run("MH12AB1001", ce_result)
    assert result["status"] == "DECLINED"


def test_inference_fallback():
    """Inference should return demo values when models not trained yet."""
    from ml.inference import predict_health, detect_anomaly
    telemetry = {"coolant_temp": 110, "oil_pressure": 30, "rpm": 2000,
                 "speed": 60, "battery_voltage": 12.5, "fuel_level": 50,
                 "coolant_temp_trend_7d": 2.0, "mileage": 50000, "dtc_count": 1}
    health = predict_health(telemetry)
    assert "health_label" in health
    anomaly = detect_anomaly(telemetry)
    assert "is_anomaly" in anomaly
