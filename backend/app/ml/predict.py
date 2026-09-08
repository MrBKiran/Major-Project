"""
M1/M2 inference — loads the joblib artifacts trained by ml/train/*.py and
scores a live telemetry window pulled from Timescale.

Artifacts are loaded lazily and cached at module scope: the backend process
is long-lived, so pay the joblib.load() cost once, not per request.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import pandas as pd

from app.ml.features import rolling_features

ARTIFACTS = Path(__file__).resolve().parents[3] / "ml" / "artifacts"

_m1 = None
_m2_clf = None
_m2_reg = None
_m4 = None

SAFETY_CRITICAL = {
    "water_pump": True, "oil_pump": True, "brake_pads": True,
    "battery": False, "fuel_injector": False, "none": False,
}

# Fallback only — the real horizons ship inside the regressor artifact, keyed
# to the simulator/vehicles.yaml the model was trained against.
# A component must beat this to be reported at all. A diffuse distribution
# (0.4 spread over three parts) is the model saying it does not know, and
# calling an owner on that basis is the failure mode the control vehicle in
# vehicles.yaml exists to catch.
MIN_COMPONENT_CONFIDENCE = 0.55

HORIZON_DAYS_FALLBACK = {
    "water_pump": 26, "battery": 21, "brake_pads": 14,
    "fuel_injector": 26, "oil_pump": 6,
}


class ModelsNotTrained(RuntimeError):
    pass


# M4's own evaluation says recall is at noise level because deviation-from-nominal
# moves with drive-cycle load by roughly the amount degradation moves it. The
# score below is therefore real but not trustworthy, and the caveat is returned
# WITH it rather than written only in a metrics file nobody calls — a consumer
# holding the number should also be holding the reason not to act on it.
M4_CAVEAT = (
    "Not reliable for decisions. Healthy and faulty score distributions overlap "
    "almost entirely (recall ~10% at a 2% false-alarm threshold) because "
    "deviation-from-nominal tracks drive-cycle load as strongly as it tracks wear. "
    "M2 is the detector this system acts on."
)


def _load_m1():
    global _m1
    if _m1 is None:
        path = ARTIFACTS / "m1_health_classifier.joblib"
        if not path.exists():
            raise ModelsNotTrained(f"{path} missing — run ml/train/train_m1_health.py")
        _m1 = joblib.load(path)
    return _m1


def _load_m2():
    global _m2_clf, _m2_reg
    if _m2_clf is None or _m2_reg is None:
        clf_path = ARTIFACTS / "m2_component_classifier.joblib"
        reg_path = ARTIFACTS / "m2_progress_regressor.joblib"
        if not clf_path.exists() or not reg_path.exists():
            raise ModelsNotTrained(f"{clf_path} / {reg_path} missing — run ml/train/train_m2_failure.py")
        _m2_clf = joblib.load(clf_path)
        _m2_reg = joblib.load(reg_path)
    return _m2_clf, _m2_reg


def _feature_row(window: pd.DataFrame, feats: list[str], odometer_km: float = 0.0) -> pd.DataFrame:
    raw = rolling_features(window)
    raw["odometer_km"] = float(odometer_km)
    row = {f: raw.get(f, 0.0) for f in feats}
    return pd.DataFrame([row])


def classify_health(window: pd.DataFrame, odometer_km: float = 0.0) -> dict[str, Any]:
    bundle = _load_m1()
    model, feats = bundle["model"], bundle["features"]
    # Always trust the fitted estimator's own class order over anything stored
    # alongside it — predict_proba columns follow model.classes_, and a stale or
    # severity-ordered list here would silently relabel every prediction.
    classes = list(getattr(model, "classes_", bundle["classes"]))
    if window.empty:
        return {"health_class": "Unknown", "proba": {}, "reason": "no telemetry in window"}

    X = _feature_row(window, feats, odometer_km)
    proba = model.predict_proba(X)[0]
    pred = classes[int(proba.argmax())]
    return {
        "health_class": pred,
        "proba": {c: round(float(p), 4) for c, p in zip(classes, proba)},
    }


def predict_component_failure(window: pd.DataFrame, odometer_km: float = 0.0) -> dict[str, Any]:
    clf_bundle, reg_bundle = _load_m2()
    clf, label_map, feats, components = (
        clf_bundle["model"], clf_bundle["label_map"], clf_bundle["features"], clf_bundle["components"],
    )
    reg = reg_bundle["model"]
    if window.empty:
        return {"predictions": [], "reason": "no telemetry in window"}

    X = _feature_row(window, feats, odometer_km)
    proba = clf.predict_proba(X)[0]
    inv_label = {i: c for c, i in label_map.items()}
    # Index through clf.classes_ rather than assuming predict_proba column i
    # means encoded label i — they only coincide when every class was present
    # in training.
    encoded = list(getattr(clf, "classes_", range(len(proba))))
    by_class = {inv_label[int(encoded[i])]: float(p) for i, p in enumerate(proba)}

    # "none" is a real prediction, not a class to discard before ranking.
    # Dropping it first meant a healthy vehicle always surfaced whichever
    # component happened to rank highest among the leftovers — the model would
    # never once say "this car is fine". Healthy wins outright when it is the
    # argmax, or whenever no component clears the confidence floor.
    p_none = by_class.get("none", 0.0)
    scored = sorted(((c, p) for c, p in by_class.items() if c != "none"),
                     key=lambda t: -t[1])
    if not scored or p_none >= scored[0][1] or scored[0][1] < MIN_COMPONENT_CONFIDENCE:
        return {"predictions": [], "healthy": True,
                "p_none": round(p_none, 4),
                "top_component": scored[0][0] if scored else None,
                "top_component_prob": round(scored[0][1], 4) if scored else 0.0}

    # The regressor predicts normalized wear progress; days-to-failure is
    # recovered per component from its known horizon (see train_m2_failure.py).
    progress = min(1.0, max(0.0, float(reg.predict(X)[0])))
    horizons = reg_bundle.get("horizon_days") or HORIZON_DAYS_FALLBACK

    predictions = []
    for component, prob in scored:
        if prob < 0.15:
            continue
        days = horizons.get(component, 14) * (1.0 - progress)
        predictions.append({
            "component": component,
            "failure_prob": round(prob, 4),
            "days_to_failure": round(days, 1),
            "severity": _severity(prob, days, component),
            "wear_progress": round(progress, 3),
        })
    return {"predictions": predictions}


def _load_m4():
    global _m4
    if _m4 is None:
        path = ARTIFACTS / "m4_anomaly_detector.joblib"
        if not path.exists():
            raise ModelsNotTrained(f"{path} missing — run ml/train/train_m4_anomaly.py")
        _m4 = joblib.load(path)
    return _m4


def detect_anomaly(window: pd.DataFrame, odometer_km: float = 0.0) -> dict[str, Any]:
    """Score a window against M4, the unsupervised detector.

    Returns the model's ACTUAL output rather than a placeholder — a fabricated
    score is worse than no score, because a caller cannot tell it apart from a
    real one. `reliable` is False and `caveat` carries the reason, so anything
    consuming this cannot pick up the number without the warning attached.
    """
    bundle = _load_m4()
    model, scaler, feats = bundle["model"], bundle["scaler"], bundle["features"]
    threshold = float(bundle["threshold"])
    if window.empty:
        return {"anomaly_score": None, "reason": "no telemetry in window",
                "reliable": False, "caveat": M4_CAVEAT}

    raw = rolling_features(window)
    raw["odometer_km"] = float(odometer_km)
    X = pd.DataFrame([{f: raw.get(f, 0.0) for f in feats}])
    # score_samples is "higher = more normal"; flipped so higher = more anomalous,
    # which is the direction the stored threshold was calibrated in.
    score = float(-model.score_samples(scaler.transform(X))[0])
    return {
        "anomaly_score": round(score, 4),
        "threshold": round(threshold, 4),
        "above_threshold": bool(score > threshold),
        "reliable": False,
        "caveat": M4_CAVEAT,
    }


def _severity(failure_prob: float, days_to_failure: float, component: str) -> str | None:
    if failure_prob < 0.4:
        return None
    critical = SAFETY_CRITICAL.get(component, False)
    if failure_prob > 0.8 and days_to_failure < 7 and critical:
        return "P1"
    if failure_prob > 0.6 and days_to_failure < 21:
        return "P2"
    return "P3"
