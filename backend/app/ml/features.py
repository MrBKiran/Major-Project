"""
Rolling-window feature engineering for M1/M2 inference.

Must produce the exact same columns, in the same way, as
ml/train/generate_dataset.py::rolling_features — that module is the source of
truth for the feature contract. Duplicated here (rather than shared as an
installable package) because training runs offline and serving runs inside
FastAPI; if you change the windows or stats in one, change them in the other.

Window sizes are row counts, not literal wall-clock durations — training
builds them from simulated ticks, serving builds them from real telemetry
rows at whatever cadence the stream publishes. What the model actually
learns is "shape of the trailing N-row window", which is consistent between
the two even though the wall-clock span it represents isn't. Good enough for
a demo-scale system; revisit if M1/M2 accuracy on live data disappoints.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

SIGNAL_NAMES = [
    "engine_rpm", "coolant_temp", "lub_oil_pressure", "lub_oil_temp",
    "fuel_pressure", "battery_voltage", "tyre_pressure", "brake_fluid_pct",
    "speed", "ambient_temp",
    "throttle_position", "intake_air_temp", "maf_rate", "engine_load",
    "intake_manifold_pressure",
]
WINDOWS = {"short": 10, "medium": 60, "long": 180}

NOMINAL_RANGES = {
    "engine_rpm": (700, 3200), "coolant_temp": (82, 96), "lub_oil_pressure": (2.6, 4.2),
    "lub_oil_temp": (75, 105), "fuel_pressure": (3.0, 6.5), "battery_voltage": (13.6, 14.4),
    "tyre_pressure": (30, 34), "brake_fluid_pct": (85, 100), "speed": (0, 90),
    "ambient_temp": (22, 41),
    "throttle_position": (8, 45), "intake_air_temp": (20, 45), "maf_rate": (3, 25),
    "engine_load": (20, 55), "intake_manifold_pressure": (30, 60),
}


def rolling_features(df: pd.DataFrame) -> dict:
    feats = {}
    for name in SIGNAL_NAMES:
        series = df[name].astype(float) if name in df.columns else pd.Series(dtype=float)
        for win_name, n in WINDOWS.items():
            tail = series.tail(n)
            feats[f"{name}_{win_name}_mean"] = float(tail.mean()) if len(tail) else 0.0
            feats[f"{name}_{win_name}_std"] = float(tail.std(ddof=0)) if len(tail) > 1 else 0.0
            if len(tail) > 1:
                x = np.arange(len(tail))
                feats[f"{name}_{win_name}_slope"] = float(np.polyfit(x, tail.values, 1)[0])
            else:
                feats[f"{name}_{win_name}_slope"] = 0.0

        lo, hi = NOMINAL_RANGES[name]
        mid, span = (lo + hi) / 2.0, max(hi - lo, 1e-6)
        last_val = float(series.iloc[-1]) if len(series) else mid
        feats[f"{name}_last"] = last_val
        feats[f"{name}_dev"] = (last_val - mid) / span

    feats["odometer_km"] = 0.0   # filled by caller if known
    feats["dtc_count"] = float(
        df["dtc_codes"].iloc[-1].__len__() if len(df) and isinstance(df["dtc_codes"].iloc[-1], list) else 0
    )
    return feats
