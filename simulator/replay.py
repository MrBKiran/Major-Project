"""
AutoSaarthi — telematics simulator.

Turns simulator/vehicles.yaml (the screenplay) into a live 1 Hz telemetry stream
published to MQTT `fleet/{vin}/telemetry`.

This IS the "Telematics API" the problem statement asks for. The models are
trained on real labelled Kaggle/UCI data; this replays that signal envelope with
scripted degradation so the demo has faults worth predicting. In Phase 2 an
ELM327 OBD-II dongle publishes to the same topic and nothing downstream changes.

Usage
-----
    python -m simulator.replay                      # all 10 vehicles → MQTT
    python -m simulator.replay --vins MH12AB1001    # one vehicle
    python -m simulator.replay --no-mqtt --ticks 40 # print to stdout, no broker
    python -m simulator.replay --dump-csv data/processed/sim_train.csv --ticks 5000

Time compression: meta.compression in vehicles.yaml. Default 43200 means one
real second = 12 simulated hours, so a 6-day degradation arc plays in ~12 s.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import random
import signal
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterator

import yaml

ROOT = Path(__file__).resolve().parents[1]
SPEC_PATH = ROOT / "simulator" / "vehicles.yaml"


def _env(key: str, default: str) -> str:
    """Read a setting from the process env, falling back to the repo-root .env.

    The backend gets .env through pydantic-settings; this module is a standalone
    script and would otherwise see only the shell's environment — which does not
    have it. That gap is how the simulator ended up publishing to a different
    broker than the ingest was subscribed to, with no error on either side and
    an empty telemetry table as the only symptom.
    """
    if key in os.environ:
        return os.environ[key]
    env_file = ROOT / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            if k.strip() == key:
                # strip an inline comment, as python-dotenv does for bare values
                return v.split("#")[0].strip().strip('"').strip("'")
    return default


# ═══════════════════════════════════════════════════════════════════════════
# Curves
# ═══════════════════════════════════════════════════════════════════════════

def _curve(kind: str, p: float, k: float = 3.0) -> float:
    """Map degradation progress p∈[0,1] onto a shape. Returns [0,1]."""
    p = max(0.0, min(1.0, p))
    if kind == "linear":
        return p
    if kind == "exponential":            # slow, then accelerating — real wear-out
        return (math.exp(k * p) - 1.0) / (math.exp(k) - 1.0)
    if kind == "logarithmic":            # fast, then plateauing — fouling
        return math.log1p(k * p) / math.log1p(k)
    return p


# ═══════════════════════════════════════════════════════════════════════════
# Vehicle simulation
# ═══════════════════════════════════════════════════════════════════════════

@dataclass
class VehicleSim:
    vin: str
    spec: dict
    signals: dict
    cycles: dict
    degradations: dict
    rng: random.Random

    progress: float = 0.0
    horizon_days: float = 9.0
    fired_dtcs: set[str] = field(default_factory=set)
    sim_seconds: float = 0.0
    _drive_phase: float = 0.0
    _override: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def build(cls, spec: dict, doc: dict, seed: int) -> "VehicleSim":
        arc = spec.get("arc") or {}
        deg_name = arc.get("degradation")
        deg = (doc["degradations"].get(deg_name) or {}) if deg_name else {}
        v = cls(
            vin=spec["vin"],
            spec=spec,
            signals=doc["signals"],
            cycles=doc["drive_cycles"],
            degradations=deg,
            rng=random.Random(f"{seed}-{spec['vin']}"),
            progress=float(arc.get("progress_at_t0") or 0.0),
            horizon_days=float(deg.get("horizon_days") or 9.0),
        )
        v._drive_phase = v.rng.random() * math.tau
        return v

    # -- helpers ---------------------------------------------------------

    def _nominal(self, name: str) -> tuple[float, float, float, tuple[float, float]]:
        s = self.signals[name]
        lo, hi = s["nominal"]
        return lo, hi, float(s.get("noise", 0.0)), tuple(s["hard"])

    @property
    def cycle(self) -> dict:
        return self.cycles[self.spec.get("drive_cycle", "mixed_fleet")]

    def _drivers(self) -> dict[str, dict]:
        return (self.degradations.get("drivers") or {})

    # -- the per-tick model ----------------------------------------------

    def _motion(self) -> dict[str, Any]:
        """Speed / gear / ignition — consistent, and drives drive_state."""
        c = self.cycle
        if self._override.get("parked"):
            return {"speed": 0.0, "gear": "P", "ignition": "on", "park_brake": True}

        # Duty cycle: is the vehicle moving at this instant?
        # For uniform x, P(sin x > t) = 1/2 − arcsin(t)/π. Inverting for a target
        # duty gives t = sin(π(1/2 − duty)). Getting this wrong makes every
        # vehicle drive ~100% of the time, which silently breaks the weekend
        # -leisure persona and the whole demand forecast.
        phase = math.sin(self.sim_seconds / 900.0 + self._drive_phase)
        threshold = math.sin(math.pi * (0.5 - c["duty"]))
        moving = phase > threshold

        if not moving:
            # parked between trips
            return {"speed": 0.0, "gear": "P", "ignition": "off", "park_brake": True}

        base = c["avg_speed"]
        wobble = math.sin(self.sim_seconds / 37.0 + self._drive_phase) * base * 0.35
        speed = max(0.0, base + wobble + self.rng.gauss(0, 2.0))

        # occasional traffic stop — this is what produces STOPPED_BRIEF
        if self.rng.random() < (c["stop_start_per_hr"] / 3600.0) * 25:
            speed = 0.0
            gear = "D"
        else:
            gear = "D" if speed > 1 else "N"
        return {"speed": round(speed, 1), "gear": gear, "ignition": "on",
                "park_brake": False}

    def tick(self, dt_sim_s: float) -> dict[str, Any]:
        self.sim_seconds += dt_sim_s

        # advance degradation
        if self.degradations:
            horizon_s = self.horizon_days * 86400.0
            self.progress = min(1.0, self.progress + dt_sim_s / horizon_s)

        motion = self._motion()
        drivers = self._drivers()
        row: dict[str, Any] = {}

        for name in self.signals:
            if name == "speed":
                row["speed"] = motion["speed"]
                continue

            lo, hi, noise, hard = self._nominal(name)
            load = {"low": 0.25, "medium": 0.5, "high": 0.8}[self.cycle["load"]]
            base = lo + (hi - lo) * load

            # engine signals collapse toward idle when stationary
            if motion["ignition"] == "off":
                if name in ("engine_rpm", "lub_oil_pressure", "fuel_pressure",
                            "throttle_position", "maf_rate", "engine_load"):
                    base = lo * 0.15
                elif name in ("coolant_temp", "lub_oil_temp"):
                    base = lo * 0.55
                elif name == "intake_manifold_pressure":
                    # MAP reads near-atmospheric with the engine off, not
                    # near-zero like the other signals collapsed above —
                    # it's a pressure sensor, not an engine-output sensor.
                    base = hard[1] * 0.95
            elif motion["speed"] < 1 and name == "engine_rpm":
                base = lo

            noise_mult = 1.0
            d = drivers.get(name)
            if d:
                if d.get("mode") == "ramp":
                    span = float(d["to"]) - float(d.get("from", 0.0))
                    base += float(d.get("from", 0.0)) + span * _curve(
                        d.get("curve", "linear"), self.progress)
                elif d.get("mode") == "variance":
                    noise_mult = 1.0 + (float(d.get("factor", 1.0)) - 1.0) * self.progress

            val = base + self.rng.gauss(0, noise * noise_mult)
            if self._override.get("dropout") == name:
                row[name] = None
                continue
            row[name] = round(max(hard[0], min(hard[1], val)), 3)

        # DTCs fire as thresholds are crossed and stay latched
        for thr, codes in sorted((self.degradations.get("dtc_at") or {}).items()):
            if self.progress >= float(thr):
                self.fired_dtcs.update(codes)

        row.update({
            "vin": self.vin,
            "ts": time.time(),
            "sim_seconds": round(self.sim_seconds, 1),
            "odometer_km": self.spec.get("odometer_km", 0),
            "gear": motion["gear"],
            "ignition": motion["ignition"],
            "park_brake": motion["park_brake"],
            "occupant_present": motion["ignition"] == "on",
            "seatbelt_driver": motion["ignition"] == "on",
            "ambient_lux": self._lux(),
            "dtc_codes": sorted(self.fired_dtcs),
            "_progress": round(self.progress, 4),
            "_degradation": (self.spec.get("arc") or {}).get("degradation"),
        })
        return row

    def _lux(self) -> int:
        """Daylight curve — drives the console's day/night theme."""
        hour = (self.sim_seconds / 3600.0) % 24
        if 6 <= hour <= 18:
            return int(90000 * math.sin(math.pi * (hour - 6) / 12) ** 0.6)
        return self.rng.randint(0, 40)

    # -- chaos knobs (the UI buttons) ------------------------------------

    def force_fault(self, progress: float = 0.95) -> None:
        self.progress = progress

    def force_dropout(self, signal_name: str | None) -> None:
        self._override["dropout"] = signal_name

    def force_parked(self, parked: bool = True) -> None:
        self._override["parked"] = parked


# ═══════════════════════════════════════════════════════════════════════════
# Drive state — SERVER-side derivation (PROJECT_PLAN §2A.3)
# ═══════════════════════════════════════════════════════════════════════════

def derive_drive_state(row: dict) -> str:
    """
    The single source of truth for what the console may render.

    Deliberately lives server-side and travels with the telemetry row. The
    console never computes this itself — UEBA rules G6/G7 gate agent actions
    on it, and a client-asserted value would be trivially spoofable.
    """
    if row.get("ignition") in ("off", "acc", None):
        return "IGNITION_OFF"
    speed = row.get("speed") or 0.0
    if speed < 1.0:
        if row.get("park_brake") or row.get("gear") == "P":
            return "PARKED"
        return "STOPPED_BRIEF"          # at a light, in gear — still not safe
    return "DRIVING"


# ═══════════════════════════════════════════════════════════════════════════
# Fleet runner
# ═══════════════════════════════════════════════════════════════════════════

class Fleet:
    def __init__(self, spec_path: Path = SPEC_PATH, vins: list[str] | None = None,
                 compression: float | None = None):
        self.doc = yaml.safe_load(open(spec_path, encoding="utf-8"))
        seed = int(self.doc["meta"].get("seed", 42))
        # Compression override matters for training data. At the demo default of
        # ×43200 each row is 12 sim-hours apart, so rolling-window features over
        # 1h/24h/7d are meaningless. Dump the CSV at ×60 (one row per sim-minute)
        # so M1/M2 train on a real time series.
        self.compression = float(
            compression if compression is not None
            else self.doc["meta"].get("compression", 1))
        self.tick_hz = float(self.doc["meta"].get("tick_hz", 1))
        specs = self.doc["vehicles"]
        if vins:
            specs = [s for s in specs if s["vin"] in vins]
        self.vehicles = {s["vin"]: VehicleSim.build(s, self.doc, seed) for s in specs}

    def tick(self) -> list[dict]:
        dt_sim = self.compression / self.tick_hz
        rows = []
        for v in self.vehicles.values():
            row = v.tick(dt_sim)
            row["drive_state"] = derive_drive_state(row)
            rows.append(row)
        return rows

    def run(self, sink: Callable[[dict], None], ticks: int | None = None,
            realtime: bool = True) -> None:
        interval = 1.0 / self.tick_hz
        n = 0
        while ticks is None or n < ticks:
            t0 = time.perf_counter()
            for row in self.tick():
                sink(row)
            n += 1
            if realtime:
                time.sleep(max(0.0, interval - (time.perf_counter() - t0)))


# ═══════════════════════════════════════════════════════════════════════════
# Sinks
# ═══════════════════════════════════════════════════════════════════════════

def mqtt_sink(host: str, port: int, prefix: str) -> Callable[[dict], None]:
    import paho.mqtt.client as mqtt  # imported lazily so --no-mqtt needs no dep

    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
    client.connect(host, port, 60)
    client.loop_start()
    print(f"[sim] publishing to mqtt://{host}:{port}/{prefix}/+/telemetry")

    def send(row: dict) -> None:
        client.publish(f"{prefix}/{row['vin']}/telemetry", json.dumps(row), qos=0)

    return send


def stdout_sink(compact: bool = True) -> Callable[[dict], None]:
    def send(row: dict) -> None:
        if compact:
            dtc = ",".join(row["dtc_codes"]) or "-"
            print(f"{row['vin']}  {row['drive_state']:<13} "
                  f"{row['speed']:>6.1f} km/h  "
                  f"coolant {row.get('coolant_temp'):>6}  "
                  f"oilP {row.get('lub_oil_pressure'):>5}  "
                  f"batt {row.get('battery_voltage'):>5}  "
                  f"prog {row['_progress']:.2f}  dtc {dtc}")
        else:
            print(json.dumps(row))
    return send


def csv_sink(path: Path) -> tuple[Callable[[dict], None], Callable[[], None]]:
    """Dump a training set with a supervised label derived from progress."""
    path.parent.mkdir(parents=True, exist_ok=True)
    f = open(path, "w", newline="", encoding="utf-8")
    writer: dict[str, Any] = {"w": None}

    def send(row: dict) -> None:
        p = row["_progress"]
        flat = {k: v for k, v in row.items() if not k.startswith("_")}
        flat["dtc_codes"] = "|".join(row["dtc_codes"])
        flat["degradation"] = row["_degradation"] or "none"
        flat["progress"] = p
        # 4-class health label (matches M1 in the plan)
        flat["health_class"] = ("Excellent" if p < 0.25 else
                                "Good" if p < 0.5 else
                                "Needs Service" if p < 0.8 else "Critical")
        flat["will_fail_7d"] = int(p >= 0.78)
        if writer["w"] is None:
            writer["w"] = csv.DictWriter(f, fieldnames=list(flat.keys()))
            writer["w"].writeheader()
        writer["w"].writerow(flat)

    return send, f.close


# ═══════════════════════════════════════════════════════════════════════════

def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="AutoSaarthi telematics simulator")
    ap.add_argument("--spec", type=Path, default=SPEC_PATH)
    ap.add_argument("--vins", nargs="*", help="subset of VINs (default: all)")
    ap.add_argument("--ticks", type=int, default=None, help="stop after N ticks")
    ap.add_argument("--no-mqtt", action="store_true", help="print instead of publish")
    ap.add_argument("--json", action="store_true", help="stdout as raw JSON")
    ap.add_argument("--dump-csv", type=Path, help="write a training CSV and exit")
    ap.add_argument("--compression", type=float, default=None,
                    help="override meta.compression. Use 60 for training dumps.")
    # Broker settings default from the same MQTT_HOST/MQTT_PORT/MQTT_TOPIC_PREFIX
    # the ingest side reads, so moving the broker moves both ends together. A
    # hardcoded 1883 here meant the simulator published to whatever else owned
    # that port while ingest listened on the configured one — no error on either
    # side, just an empty telemetry table.
    ap.add_argument("--host", default=_env("MQTT_HOST", "localhost"))
    ap.add_argument("--port", type=int, default=int(_env("MQTT_PORT", "1883")))
    ap.add_argument("--prefix", default=_env("MQTT_TOPIC_PREFIX", "fleet"))
    args = ap.parse_args(argv)

    compression = args.compression
    if compression is None and args.dump_csv:
        compression = 60.0          # one row per simulated minute
    fleet = Fleet(args.spec, args.vins, compression)
    print(f"[sim] {len(fleet.vehicles)} vehicles | compression ×{fleet.compression:.0f} "
          f"(1 s ≈ {fleet.compression / 3600:.1f} sim-hours)")

    close = None
    if args.dump_csv:
        sink, close = csv_sink(args.dump_csv)
        fleet.run(sink, ticks=args.ticks or 2000, realtime=False)
        close()
        print(f"[sim] wrote {args.dump_csv}")
        return 0

    sink = stdout_sink(compact=not args.json) if args.no_mqtt else \
        mqtt_sink(args.host, args.port, args.prefix)

    stop = {"flag": False}
    signal.signal(signal.SIGINT, lambda *_: stop.__setitem__("flag", True))
    try:
        fleet.run(sink, ticks=args.ticks)
    except KeyboardInterrupt:
        pass
    finally:
        if close:
            close()
    print("\n[sim] stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
