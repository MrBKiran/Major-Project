"""Tests for vehicle simulator"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

def test_generates_telemetry():
    from app.simulators import generate_demo_telemetry
    t = generate_demo_telemetry("MH12AB1001")
    assert t["vin"] == "MH12AB1001"
    assert "coolant_temp" in t
    assert "rpm" in t

def test_hero_vehicle_elevated_coolant():
    from app.simulators import generate_demo_telemetry
    temps = [generate_demo_telemetry("MH12AB1001")["coolant_temp"] for _ in range(20)]
    assert max(temps) > 90  # hero vehicle should show elevated temps
