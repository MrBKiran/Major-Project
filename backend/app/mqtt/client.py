import asyncio, json, logging
from datetime import datetime
import paho.mqtt.client as mqtt
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("mqtt")

telemetry_buffer: list[dict] = []

def on_connect(client, userdata, flags, rc):
    logger.info(f"MQTT connected rc={rc}")
    client.subscribe("fleet/+/telemetry")

def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload)
        data["_topic"] = msg.topic
        data["_received"] = datetime.utcnow().isoformat()
        telemetry_buffer.append(data)
        if len(telemetry_buffer) > 5000:
            telemetry_buffer.pop(0)
    except Exception as e:
        logger.error(f"MQTT parse error: {e}")

async def start_mqtt():
    client = mqtt.Client()
    client.on_connect = on_connect
    client.on_message = on_message
    try:
        client.connect(settings.mqtt_host, settings.mqtt_port, 60)
        client.loop_start()
        logger.info("MQTT loop started")
    except Exception as e:
        logger.warning(f"MQTT unavailable: {e}")

def get_latest_telemetry(vin: str, n: int = 1) -> list[dict]:
    return [t for t in telemetry_buffer if f"fleet/{vin}/telemetry" == t.get("_topic")][-n:]
