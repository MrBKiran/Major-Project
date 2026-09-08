"""
AutoSaarthi MQTT Client
Subscribes to fleet/{vin}/telemetry and pushes data to WebSocket + DB.
"""
import json
import asyncio
import paho.mqtt.client as mqtt
from api.websocket_manager import ws_manager


class MQTTClient:
    def __init__(self, host: str, port: int):
        self.host = host
        self.port = port
        self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self._loop: asyncio.AbstractEventLoop | None = None

    def _on_connect(self, client, userdata, flags, reason_code, properties):
        print(f"[MQTT] Connected: {reason_code}")
        client.subscribe("fleet/+/telemetry")
        client.subscribe("fleet/+/dtc")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            topic = msg.topic  # fleet/{vin}/telemetry
            vin = topic.split("/")[1]
            payload["vin"] = vin
            if self._loop:
                asyncio.run_coroutine_threadsafe(
                    ws_manager.broadcast("telemetry", payload), self._loop
                )
        except Exception as e:
            print(f"[MQTT] Error processing message: {e}")

    async def start(self):
        self._loop = asyncio.get_event_loop()
        self.client.connect_async(self.host, self.port)
        self.client.loop_start()
        print(f"[MQTT] Connecting to {self.host}:{self.port}")

    async def stop(self):
        self.client.loop_stop()
        self.client.disconnect()

    def publish(self, topic: str, payload: dict):
        self.client.publish(topic, json.dumps(payload))
