"""
M4 — Vehicle Anomaly Detector (PROJECT_PLAN §4).

IsolationForest over the telemetry feature vector, trained on healthy windows
only. Its job is the complement of M2's: M2 recognises the five wear patterns
it was taught, M4 flags anything that simply does not look like a healthy
vehicle — including failure modes never present in training.

The same algorithm scores agent behaviour in app/ueba/baseline.py. One
technique, two domains: vehicles that misbehave and agents that misbehave are
both "this vector is far from the normal manifold".

Trained on healthy rows only (contamination='auto' would otherwise let genuine
faults define part of the normal envelope).

Run:  cd ml/train && python train_m4_anomaly.py
"""

from __future__ import annotations

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler

from common import ARTIFACTS, feature_columns, load_training_frame, save_json

# Healthy = no active degradation label. Everything else may carry wear.
HEALTHY_LABEL = "none"


def anomaly_features(df) -> list[str]:
    """A deliberately narrow feature set for M4.

    The full 92-column vector defeats IsolationForest here: with only a few
    hundred healthy rows, random splits across 92 largely-redundant dimensions
    almost never isolate on the handful that actually move, and recall sits at
    noise level. Deviation-from-nominal and long-window slope are precisely the
    directions degradation pushes, so restricting to them raises the signal
    density per split instead of diluting it.
    """
    return [c for c in df.columns if c.endswith(("_dev", "_long_slope"))] + ["dtc_count"]


def main() -> None:
    df = load_training_frame()
    feats = anomaly_features(df)

    # Select on `degradation`, not `component`. M2's label deliberately calls
    # early-wear rows "none" (they carry no actionable signature), but those
    # vehicles ARE degrading — training the normal manifold on them widens it
    # to include the very drift M4 is supposed to notice, which collapsed
    # recall to 4%. Healthy here means no degradation arc at all.
    healthy = df[df["degradation"] == "none"]
    faulty = df[(df["degradation"] != "none") & (df["progress"] >= 0.5)]
    if healthy.empty:
        raise SystemExit("no healthy rows in the training set")

    scaler = StandardScaler().fit(healthy[feats].fillna(0.0))
    X_healthy = scaler.transform(healthy[feats].fillna(0.0))
    X_faulty = scaler.transform(faulty[feats].fillna(0.0))

    model = IsolationForest(
        n_estimators=200, contamination=0.02, random_state=42, n_jobs=1,
    ).fit(X_healthy)

    # score_samples: higher = more normal. Flip so higher = more anomalous,
    # which is the direction every consumer expects.
    healthy_scores = -model.score_samples(X_healthy)
    faulty_scores = -model.score_samples(X_faulty)

    # Threshold at the 98th percentile of healthy — i.e. accept a 2% false
    # alarm rate on known-good vehicles, and measure what that buys in recall.
    threshold = float(np.percentile(healthy_scores, 98))
    recall = float((faulty_scores > threshold).mean())
    false_alarm = float((healthy_scores > threshold).mean())

    joblib.dump(
        {"model": model, "scaler": scaler, "features": feats, "threshold": threshold},
        ARTIFACTS / "m4_anomaly_detector.joblib",
    )
    save_json({
        "model": "IsolationForest(n_estimators=200, contamination=0.02)",
        "trained_on": "healthy windows only",
        "n_healthy_train": int(len(healthy)), "n_faulty_eval": int(len(faulty)),
        "threshold_p98_healthy": round(threshold, 4),
        "recall_on_faulty": round(recall, 4),
        "false_alarm_rate_on_healthy": round(false_alarm, 4),
        "status": "NOT demo-ready — see limitation",
        "limitation": (
            "Recall is at noise level and this is a modelling confound, not a "
            "tuning issue: healthy and faulty score distributions overlap almost "
            "exactly (means ~0.48 vs ~0.51) across max_samples 32-256. Cause is "
            "drive-cycle load. deviation-from-nominal moves with load (0.25-0.8) "
            "by roughly the same magnitude degradation moves it, so a hard-working "
            "healthy vehicle is indistinguishable from a lightly-worn idle one. "
            "Fixing it needs load-conditioned features (residuals after regressing "
            "out drive cycle), not different hyperparameters. Do NOT put this "
            "number on a slide."
        ),
        "note": ("M2 (supervised, 97% acc) is the detector the demo relies on. The "
                  "same IsolationForest technique DOES work on the agent side in "
                  "app/ueba/baseline.py, which is the UEBA Layer B story."),
    }, ARTIFACTS / "m4_metrics.json")

    print(f"[m4] threshold(p98 healthy) = {threshold:.4f}")
    print(f"[m4] recall on faulty       = {recall:.1%}")
    print(f"[m4] false alarm on healthy = {false_alarm:.1%}")
    print(f"[m4] artifacts written to {ARTIFACTS}")


if __name__ == "__main__":
    main()
