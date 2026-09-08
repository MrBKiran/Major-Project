"""
MQTT Vehicle Telemetry Simulator — publishes to fleet/{vin}/telemetry
"""
import json, time, random, math, os, logging
from datetime import datetime
import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("simulator")

MQTT_HOST = os.getenv("MQTT_HOST", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", 1883))

PERSONAS = {
    "MH12AB1001": {"scenario": "coolant_rise",    "coolant": 92.0},
    "MH12AB1002": {"scenario": "normal",           "coolant": 87.0},
    "KA03CD2001": {"scenario": "battery_drain",    "coolant": 86.0},
    "MH04EF3001": {"scenario": "normal",           "coolant": 85.0},
    "TN09GH4001": {"scenario": "coolant_rise",    "coolant": 94.0},
    "DL01IJ5001": {"scenario": "oil_pressure_low", "coolant": 87.0},
    "MH02KL6001": {"scenario": "coolant_rise",    "coolant": 98.0},
    "GJ01MN7001": {"scenario": "normal",           "coolant": 84.0},
    "RJ14OP8001": {"scenario": "normal",           "coolant": 88.0},
    "WB06QR9001": {"scenario": "normal",           "coolant": 86.0},
}

state = {vin: dict(p) for vin, p in PERSONAS.items()}

def noise(val, sigma=0.5):
    return round(val + random.gauss(0, sigma), 2)

def step(vin: str) -> dict:
    s = state[vin]
    dtc = []
    oil = 35.0
    bat = 12.4

    if s["scenario"] == "coolant_rise":
        s["coolant"] = min(s["coolant"] + random.uniform(0.05, 0.3), 115)
        if s["coolant"] > 105:
            dtc.append("P0217")
    elif s["scenario"] == "battery_drain":
        bat = noise(11.5, 0.2)
        dtc.append("B1000")
    elif s["scenario"] == "oil_pressure_low":
        oil = noise(22.0, 1.5)
        dtc.append("P0524")

    return {
        "vin": vin,
        "timestamp": datetime.utcnow().isoformat(),
        "speed": noise(random.uniform(10, 70)),
        "rpm": noise(random.uniform(900, 2800), 80),
        "coolant_temp": noise(s["coolant"], 0.5),
        "oil_pressure": noise(oil, 0.5),
        "battery_voltage": noise(bat, 0.05),
        "fuel_level": noise(random.uniform(30, 85), 0.3),
        "engine_load": noise(random.uniform(30, 70), 1.5),
        "dtc": dtc,
    }

def main():
    client = mqtt.Client()
    while True:
        try:
            client.connect(MQTT_HOST, MQTT_PORT, 60)
            logger.info(f"Connected to MQTT {MQTT_HOST}:{MQTT_PORT}")
            break
        except Exception as e:
            logger.warning(f"MQTT not ready: {e}, retrying in 5s...")
            time.sleep(5)

    client.loop_start()
    logger.info(f"Publishing telemetry for {len(PERSONAS)} vehicles...")
    while True:
        for vin in PERSONAS:
            payload = step(vin)
            topic = f"fleet/{vin}/telemetry"
            client.publish(topic, json.dumps(payload))
        time.sleep(2)

if __name__ == "__main__":
    main()
