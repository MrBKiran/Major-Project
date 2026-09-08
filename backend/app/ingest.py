"""
AutoSaarthi — MQTT → Timescale ingest.

Subscribes to `{prefix}/+/telemetry` (published by simulator/replay.py or, in
Phase 2, a real ELM327 bridge — same topic, zero downstream changes) and
writes each row into the `telemetry` hypertable. Runs as its own process so a
backend restart doesn't drop in-flight MQTT messages.

Run:  cd backend && python -m app.ingest
"""

from __future__ import annotations

import datetime as dt
import json
import signal
import time

import paho.mqtt.client as mqtt

from app.config import settings
from app.db.models import Telemetry
from app.db.session import SessionLocal, init_db

FIELDS = [
    "engine_rpm", "coolant_temp", "lub_oil_pressure", "lub_oil_temp",
    "fuel_pressure", "battery_voltage", "tyre_pressure", "brake_fluid_pct",
    "speed", "ambient_temp",
    "throttle_position", "intake_air_temp", "maf_rate", "engine_load",
    "intake_manifold_pressure",
]


def _row_to_telemetry(vin: str, payload: dict) -> Telemetry:
    ts = dt.datetime.fromtimestamp(payload.get("ts", dt.datetime.now().timestamp()), tz=dt.timezone.utc)
    return Telemetry(
        ts=ts, vin=vin,
        **{f: payload.get(f) for f in FIELDS},
        drive_state=payload.get("drive_state"),
        dtc_codes=payload.get("dtc_codes") or [],
    )


def main() -> None:
    init_db()
    n_written = {"count": 0}

    def on_connect(client, userdata, flags, reason_code, properties=None):
        topic = f"{settings.mqtt_topic_prefix}/+/telemetry"
        client.subscribe(topic)
        print(f"[ingest] subscribed to {topic}")

    def on_message(client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            vin = payload.get("vin") or msg.topic.split("/")[1]
            row = _row_to_telemetry(vin, payload)
        except Exception as e:  # noqa: BLE001 — never let a bad row kill the ingest loop
            print(f"[ingest] bad payload on {msg.topic}: {e}")
            return

        with SessionLocal() as session:
            session.merge(row)
            session.commit()
        n_written["count"] += 1
        if n_written["count"] % 50 == 0:
            print(f"[ingest] {n_written['count']} rows written (last vin={vin})")

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.on_connect = on_connect
    client.on_message = on_message
    client.connect(settings.mqtt_host, settings.mqtt_port, 60)

    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("flag", True))
    print(f"[ingest] connecting to mqtt://{settings.mqtt_host}:{settings.mqtt_port}")
    client.loop_start()
    try:
        while not stop["flag"]:
            time.sleep(1)   # signal.pause() isn't available on Windows
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        print(f"[ingest] stopped — {n_written['count']} rows total")


if __name__ == "__main__":
    main()
