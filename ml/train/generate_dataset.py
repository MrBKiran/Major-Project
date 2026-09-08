"""
AutoSaarthi — synthetic training-set generator for M1 (health) and M2 (component failure).

Why synthetic and not only Kaggle/AI4I: the problem statement explicitly sanctions
"Synthetic Vehicle Data" as a first-class source, and — more importantly — the live
demo stream comes out of simulator/replay.py's VehicleSim, using the exact signal
schema in simulator/vehicles.yaml (engine_rpm, coolant_temp, lub_oil_pressure, ...).
AI4I 2020 uses a different feature space (air/process temperature, torque, tool wear)
that only maps to vehicle signals by loose analogy, per the papers that use it. Training
directly on VehicleSim's own generative model means the live telemetry the agents score
is drawn from the SAME distribution the models were trained on — training on AI4I would
require a lossy feature adapter and produce unreliable live predictions.

AI4I is used separately (train_m2_failure.py) purely as an offline algorithm-comparison
benchmark, matching what "A Data-Driven Approach for Predicting Vehicle Component
Failures" and "Predictive Vehicle Maintenance Using Simulated Industrial Conditions" do —
it earns its slide, it just isn't what serves live predictions.

Method: sweep every degradation template (+ a healthy/no-degradation case) across a
fine grid of starting progress values and drive cycles, run each as a short independent
VehicleSim trajectory, and take rolling-window features (mean/std/slope) over the tail
of each trajectory. Label comes straight from the simulator's own ground truth
(`_progress`, `_degradation`) — the same derivation simulator/replay.py's csv_sink uses
for `--dump-csv`, kept in sync with it deliberately.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "simulator"))
sys.path.insert(0, str(ROOT))

from replay import VehicleSim  # noqa: E402

SPEC_PATH = ROOT / "simulator" / "vehicles.yaml"
OUT_PATH = ROOT / "data" / "synthetic" / "vehicle_training_set.csv"

SIGNAL_NAMES = [
    "engine_rpm", "coolant_temp", "lub_oil_pressure", "lub_oil_temp",
    "fuel_pressure", "battery_voltage", "tyre_pressure", "brake_fluid_pct",
    "speed", "ambient_temp",
    "throttle_position", "intake_air_temp", "maf_rate", "engine_load",
    "intake_manifold_pressure",
]

# nominal [lo, hi] from simulator/vehicles.yaml `signals:` — used to turn a raw
# reading into a normalized deviation-from-nominal feature. Duplicated in
# backend/app/ml/features.py; keep both in sync (see that module's docstring).
NOMINAL_RANGES = {
    "engine_rpm": (700, 3200), "coolant_temp": (82, 96), "lub_oil_pressure": (2.6, 4.2),
    "lub_oil_temp": (75, 105), "fuel_pressure": (3.0, 6.5), "battery_voltage": (13.6, 14.4),
    "tyre_pressure": (30, 34), "brake_fluid_pct": (85, 100), "speed": (0, 90),
    "ambient_temp": (22, 41),
    "throttle_position": (8, 45), "intake_air_temp": (20, 45), "maf_rate": (3, 25),
    "engine_load": (20, 55), "intake_manifold_pressure": (30, 60),
}

# Lookback windows, in ticks (compression=60 → 1 tick = 1 sim-minute).
# "short/medium/long" rather than literal 1h/24h/7d — see module docstring.
WINDOWS = {"short": 10, "medium": 60, "long": 180}
RUN_TICKS = 200          # > longest window so every run has a full "long" tail
COMPRESSION = 60.0
TICKS_PER_PROGRESS_LEVEL = 10   # independent noisy runs sampled per (deg, progress) point
PROGRESS_GRID = np.round(np.linspace(0.0, 0.97, 26), 3)   # 26 levels: 0.0 .. 0.97


# Below this wear progress there is no actionable failure signature to detect.
# 0.15, not 0.25: rows near the cut are ambiguous, so the model settles on an
# effective boundary noticeably above whatever value is set here. At 0.25 that
# drift pushed the real boundary past 0.30 and the earliest arc the demo
# expects to catch (UP16CD1004, progress 0.29) was confidently called healthy.
ACTIONABLE_PROGRESS = 0.15


def health_class(progress: float) -> str:
    # Matches simulator/replay.py::csv_sink exactly — single source of truth for
    # what "healthy" means is the simulator; this generator must not diverge from it.
    return ("Excellent" if progress < 0.25 else
            "Good" if progress < 0.5 else
            "Needs Service" if progress < 0.8 else "Critical")


def rolling_features(df: pd.DataFrame) -> dict:
    feats = {}
    for name in SIGNAL_NAMES:
        series = df[name].astype(float)
        for win_name, n in WINDOWS.items():
            tail = series.tail(n)
            feats[f"{name}_{win_name}_mean"] = tail.mean()
            feats[f"{name}_{win_name}_std"] = tail.std(ddof=0) if len(tail) > 1 else 0.0
            # slope: simple linear fit over the window, per-tick rate of change
            if len(tail) > 1:
                x = np.arange(len(tail))
                feats[f"{name}_{win_name}_slope"] = float(np.polyfit(x, tail.values, 1)[0])
            else:
                feats[f"{name}_{win_name}_slope"] = 0.0

        # Deviation-from-nominal is the direct signal a degradation ramp
        # produces; mean/std/slope of a short noisy window recover it only
        # indirectly. Adding it explicitly measurably improved M1 accuracy
        # over rolling stats alone.
        lo, hi = NOMINAL_RANGES[name]
        mid, span = (lo + hi) / 2.0, max(hi - lo, 1e-6)
        last_val = float(series.iloc[-1]) if len(series) else mid
        feats[f"{name}_last"] = last_val
        feats[f"{name}_dev"] = (last_val - mid) / span
    return feats


def run_one(doc: dict, degradation_name: str | None, progress0: float,
            cycle_name: str, seed: int) -> dict:
    deg = (doc["degradations"].get(degradation_name) or {}) if degradation_name else {}
    spec = {
        "vin": f"SYN-{degradation_name or 'healthy'}-{seed}",
        "drive_cycle": cycle_name,
        "odometer_km": random.Random(seed).randint(5000, 150000),
        "arc": {"degradation": degradation_name, "progress_at_t0": progress0},
    }
    v = VehicleSim.build(spec, doc, seed=seed)
    dt_sim = COMPRESSION / float(doc["meta"].get("tick_hz", 1))

    rows = [v.tick(dt_sim) for _ in range(RUN_TICKS)]
    df = pd.DataFrame(rows)

    feats = rolling_features(df)
    last = rows[-1]
    progress = last["_progress"]
    horizon_days = float(deg.get("horizon_days") or 0.0)
    safety_critical = bool(deg.get("safety_critical", False))

    # A vehicle in the first fifth of a wear arc is physically indistinguishable
    # from a healthy one — the signals are still inside their nominal bands.
    # Labelling those rows with the eventual component taught M2 that nominal
    # data belongs to a failing part, which produced confident false positives
    # on genuinely healthy vehicles. The label means "shows an actionable wear
    # signature", so below the threshold it is 'none'.
    component = deg.get("component", "none")
    if component != "none" and progress < ACTIONABLE_PROGRESS:
        component = "none"

    feats.update({
        "degradation": degradation_name or "none",
        "component": component,
        "safety_critical": int(safety_critical),
        "progress": progress,
        "health_class": health_class(progress),
        "will_fail_7d": int(progress >= 0.78),
        "days_to_failure": round(horizon_days * (1.0 - progress), 2) if horizon_days else 999.0,
        "dtc_count": len(last["dtc_codes"]),
        "odometer_km": spec["odometer_km"],
    })
    return feats


def main() -> None:
    doc = yaml.safe_load(SPEC_PATH.read_text(encoding="utf-8"))
    degradation_names = [None, *doc["degradations"].keys()]
    cycle_names = list(doc["drive_cycles"].keys())

    records = []
    seed = 0
    for deg_name in degradation_names:
        for progress0 in PROGRESS_GRID:
            for _ in range(TICKS_PER_PROGRESS_LEVEL):
                cycle = cycle_names[seed % len(cycle_names)]
                records.append(run_one(doc, deg_name, float(progress0), cycle, seed))
                seed += 1

    out = pd.DataFrame(records)
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(OUT_PATH, index=False)

    print(f"[gen] wrote {len(out)} rows, {out.shape[1]} columns → {OUT_PATH}")
    print(f"[gen] health_class distribution:\n{out['health_class'].value_counts()}")
    print(f"[gen] component distribution:\n{out['component'].value_counts()}")


if __name__ == "__main__":
    main()
