"""
Vehicle Telemetry Simulator
10 vehicle personas with deliberate demo scenarios
"""
import random, math
from datetime import datetime

# Persona configs: vin -> degradation scenario
PERSONAS = {
    "MH12AB1001": {"scenario": "coolant_rise",    "base_coolant": 95},  # hero Bolero
    "MH12AB1002": {"scenario": "normal",           "base_coolant": 88},  # Thar (declined)
    "KA03CD2001": {"scenario": "battery_drain",    "base_coolant": 87},
    "MH04EF3001": {"scenario": "normal",           "base_coolant": 86},
    "TN09GH4001": {"scenario": "coolant_rise",    "base_coolant": 97},
    "DL01IJ5001": {"scenario": "oil_pressure_low", "base_coolant": 88},
    "MH02KL6001": {"scenario": "coolant_rise",    "base_coolant": 100},
    "GJ01MN7001": {"scenario": "normal",           "base_coolant": 85},
    "RJ14OP8001": {"scenario": "normal",           "base_coolant": 89},
    "WB06QR9001": {"scenario": "normal",           "base_coolant": 87},
}

def _noise(val, sigma=0.5):
    return round(val + random.gauss(0, sigma), 2)

def generate_demo_telemetry(vin: str) -> dict:
    p = PERSONAS.get(vin, {"scenario": "normal", "base_coolant": 88})
    t = datetime.utcnow().isoformat()

    coolant = p["base_coolant"]
    oil_pressure = 35.0
    battery = 12.4
    dtc = []

    if p["scenario"] == "coolant_rise":
        coolant = _noise(coolant + random.uniform(0, 3), 1.5)
        if coolant > 105:
            dtc.append("P0217")  # Coolant overtemp
    elif p["scenario"] == "battery_drain":
        battery = _noise(11.8, 0.2)
        dtc.append("B1000")
    elif p["scenario"] == "oil_pressure_low":
        oil_pressure = _noise(24.0, 2.0)
        dtc.append("P0524")

    return {
        "vin": vin,
        "timestamp": t,
        "speed": _noise(random.uniform(0, 80)),
        "rpm": _noise(random.uniform(800, 3000), 100),
        "coolant_temp": _noise(coolant, 1.0),
        "oil_pressure": _noise(oil_pressure, 1.0),
        "battery_voltage": _noise(battery, 0.1),
        "fuel_level": _noise(random.uniform(20, 90), 0.5),
        "engine_load": _noise(random.uniform(30, 75), 2.0),
        "dtc": dtc,
    }
