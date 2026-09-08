import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
import pytest
from app.api.chat import generate_realistic_diagnosis, DTC_DETAILS

def test_chat_dtc_catalog():
    assert "P0217" in DTC_DETAILS
    assert "P0524" in DTC_DETAILS
    assert "B1000" in DTC_DETAILS
    assert DTC_DETAILS["P0217"]["severity"] == "CRITICAL"

def test_chat_overheat_diagnostic():
    telem = {"coolant_temp": 102.5, "battery_voltage": 12.3, "oil_pressure": 35.0, "rpm": 2200, "speed": 40, "dtc": ["P0217"]}
    pred = {"failure": {"failure_probability": 0.92, "days_to_fail": 30}, "health": {"class": "Critical"}}
    vehicle = {"vin": "MH12AB1001", "model": "Bolero", "variant": "B6", "customer": {"name": "Ramesh Kumar"}}
    
    resp = generate_realistic_diagnosis("engine is overheating, what should I do?", "MH12AB1001", telem, pred, vehicle, "en")
    assert resp.severity == "CRITICAL"
    assert len(resp.checklist) > 0
    assert "102.5" in resp.reply or "coolant" in resp.reply.lower()
    assert resp.recommended_action is not None
    assert resp.recommended_action.action_type == "BOOK_APPOINTMENT"

def test_chat_battery_diagnostic():
    telem = {"coolant_temp": 88.0, "battery_voltage": 11.6, "oil_pressure": 35.0, "rpm": 1200, "speed": 0, "dtc": ["B1000"]}
    pred = {"failure": {"failure_probability": 0.40, "days_to_fail": 60}, "health": {"class": "Needs Service"}}
    vehicle = {"vin": "KA03CD2001", "model": "Scorpio-N", "variant": "Z8", "customer": {"name": "Suresh Reddy"}}
    
    resp = generate_realistic_diagnosis("my battery is draining, will it start tomorrow?", "KA03CD2001", telem, pred, vehicle, "en")
    assert resp.severity == "WARNING"
    assert "11.60" in resp.reply or "battery" in resp.reply.lower()
    assert resp.recommended_action is not None

def test_chat_dtc_lookup():
    telem = {"coolant_temp": 89.0, "battery_voltage": 12.4, "oil_pressure": 35.0, "rpm": 2000, "speed": 50, "dtc": []}
    pred = {"failure": {"failure_probability": 0.10, "days_to_fail": 100}, "health": {"class": "Good"}}
    vehicle = {"vin": "MH12AB1001", "model": "Bolero", "variant": "B6", "customer": {"name": "Ramesh Kumar"}}
    
    resp = generate_realistic_diagnosis("explain DTC code P0524", "MH12AB1001", telem, pred, vehicle, "en")
    assert resp.severity == "CRITICAL"
    assert "Engine Oil Pressure Low" in resp.reply
    assert "P0524" in resp.dtc_detected
