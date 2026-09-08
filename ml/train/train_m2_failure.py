"""
M2 — Component Failure Predictor (Diagnosis Agent).

Two models trained on the same rolling-window features as M1:
  1. component_clf   — multiclass over {none, water_pump, battery, brake_pads,
                        fuel_injector, oil_pump}. failure_prob = 1 - P(none).
  2. days_to_failure  — XGBoost regressor, trained only on rows with an active
                        degradation (a sentinel "999" for healthy rows would
                        just teach the regressor to predict the sentinel).

Severity (P1/P2/P3) is a deterministic rule (PROJECT_PLAN §4), not a trained
output — applied at inference time in tools/core.py so the threshold is
auditable and editable without retraining.

Basis: "A Data-Driven Approach for Predicting Vehicle Component Failures" (2025)
and "Predictive Vehicle Maintenance Using Simulated Industrial Conditions" (2025,
XGBoost 0.989 on AI4I). We reproduce the AI4I comparison table those papers show
(train_m2_ai4i_benchmark below) purely for slide credibility — it is NOT the
model that serves live predictions, because AI4I's feature space (air/process
temperature, torque, tool wear) doesn't match the vehicle telemetry schema the
live agents actually see.

Run:  cd ml/train && ../../.venv/Scripts/python.exe train_m2_failure.py
"""

from __future__ import annotations

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, mean_absolute_error, precision_score, recall_score
from sklearn.model_selection import train_test_split
from sklearn.tree import DecisionTreeClassifier

from common import ARTIFACTS, DATA_PATH, ROOT, feature_columns, load_training_frame, save_confusion_matrix, save_json

COMPONENTS = ["none", "water_pump", "battery", "brake_pads", "fuel_injector", "oil_pump"]

# component → safety_critical, sourced from simulator/vehicles.yaml `degradations`.
SAFETY_CRITICAL = {
    "water_pump": True, "oil_pump": True, "brake_pads": True,
    "battery": False, "fuel_injector": False, "none": False,
}

# component → horizon_days, also from vehicles.yaml `degradations`. Mirrored in
# backend/app/ml/predict.py; keep both in sync with the YAML.
HORIZON_DAYS = {
    "water_pump": 26, "battery": 21, "brake_pads": 14,
    "fuel_injector": 26, "oil_pump": 6,
}


def severity(failure_prob: float, days_to_failure: float, component: str) -> str | None:
    if component == "none" or failure_prob < 0.4:
        return None
    critical = SAFETY_CRITICAL.get(component, False)
    if failure_prob > 0.8 and days_to_failure < 7 and critical:
        return "P1"
    if failure_prob > 0.6 and days_to_failure < 21:
        return "P2"
    return "P3"


def train_component_classifier(df: pd.DataFrame, feats: list[str]) -> dict:
    X = df[feats].fillna(0.0)
    y = df["component"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    le = {c: i for i, c in enumerate(COMPONENTS)}
    model = xgb.XGBClassifier(
        n_estimators=150, max_depth=6, learning_rate=0.1,
        objective="multi:softprob", eval_metric="mlogloss", random_state=42,
    )
    model.fit(X_train, y_train.map(le))
    pred_idx = model.predict(X_test)
    pred = pd.Series(pred_idx).map({i: c for c, i in le.items()})

    save_confusion_matrix(
        y_test, pred, COMPONENTS,
        ARTIFACTS / "m2_component_confusion_matrix.png",
        "M2 Component Classifier — XGBoost",
    )
    metrics = {
        "accuracy": round(accuracy_score(y_test, pred), 4),
        "f1_macro": round(f1_score(y_test, pred, average="macro", zero_division=0), 4),
    }
    return {"model": model, "label_map": le, "metrics": metrics}


def train_progress_regressor(df: pd.DataFrame, feats: list[str]) -> dict:
    """Predict normalized wear progress (0-1), not raw days.

    days_to_failure = horizon_days[component] x (1 - progress), and horizons
    range from 6 (oil pump) to 26 (water pump / injector). Regressing on days
    directly forces one head to infer component identity, wear level, and that
    component's horizon simultaneously. Progress is the quantity the sensor
    deviations actually encode, so it's the learnable part; the horizon lookup
    is exact, and inference recombines them.
    """
    active = df[df["component"] != "none"]
    X = active[feats].fillna(0.0)
    y = active["progress"]
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)
    model = xgb.XGBRegressor(n_estimators=150, max_depth=5, learning_rate=0.1, random_state=42)
    model.fit(X_train, y_train)
    pred = model.predict(X_test)

    mae_progress = float(mean_absolute_error(y_test, pred))
    # Report the equivalent day error too, so the metric stays comparable to
    # the previous days-regressor and is meaningful on a slide.
    horizons = active.loc[y_test.index, "component"].map(HORIZON_DAYS).astype(float)
    mae_days = float(mean_absolute_error(y_test * horizons, pd.Series(pred, index=y_test.index) * horizons))
    return {"model": model, "metrics": {"mae_progress": round(mae_progress, 4),
                                         "mae_days_equivalent": round(mae_days, 3)}}


def ai4i_benchmark() -> list[dict]:
    """Offline algorithm-comparison table on the real AI4I 2020 dataset —
    reproduces the two cited papers' methodology. Not used for live serving."""
    ai4i_path = ROOT / "data" / "raw" / "ai4i2020.csv"
    if not ai4i_path.exists():
        return []

    ai4i = pd.read_csv(ai4i_path)
    ai4i = ai4i.rename(columns={
        "Air temperature [K]": "air_temp", "Process temperature [K]": "process_temp",
        "Rotational speed [rpm]": "rpm", "Torque [Nm]": "torque",
        "Tool wear [min]": "tool_wear", "Machine failure": "failure",
    })
    feats = ["air_temp", "process_temp", "rpm", "torque", "tool_wear"]
    X = ai4i[feats]
    y = ai4i["failure"]
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    candidates = {
        "LogisticRegression": LogisticRegression(max_iter=2000),
        "DecisionTree": DecisionTreeClassifier(max_depth=8, random_state=42),
        "RandomForest": RandomForestClassifier(n_estimators=120, random_state=42),
        "XGBoost": xgb.XGBClassifier(
            n_estimators=120, max_depth=5, learning_rate=0.1,
            eval_metric="logloss", random_state=42,
        ),
    }
    rows = []
    for name, model in candidates.items():
        model.fit(X_train, y_train)
        pred = model.predict(X_test)
        rows.append({
            "model": name,
            "accuracy": round(accuracy_score(y_test, pred), 4),
            "f1": round(f1_score(y_test, pred, zero_division=0), 4),
        })
    return sorted(rows, key=lambda r: -r["accuracy"])


def main() -> None:
    df = load_training_frame()
    feats = feature_columns(df)

    clf = train_component_classifier(df, feats)
    reg = train_progress_regressor(df, feats)
    benchmark = ai4i_benchmark()

    joblib.dump(
        {"model": clf["model"], "label_map": clf["label_map"], "features": feats,
         "components": COMPONENTS},
        ARTIFACTS / "m2_component_classifier.joblib",
    )
    joblib.dump(
        {"model": reg["model"], "features": feats, "horizon_days": HORIZON_DAYS,
         "target": "progress"},
        ARTIFACTS / "m2_progress_regressor.joblib",
    )

    save_json({
        "component_classifier": clf["metrics"],
        "progress_regressor": reg["metrics"],
        "horizon_days": HORIZON_DAYS,
        "safety_critical_map": SAFETY_CRITICAL,
        "severity_rule": "P1: prob>0.8 & days<7 & safety_critical | P2: prob>0.6 & days<21 | P3: else",
        "ai4i_benchmark_table": benchmark,
        "ai4i_benchmark_note": (
            "Reproduced from the cited papers' methodology on the real AI4I 2020 "
            "dataset for credibility — this table is NOT the model serving live "
            "predictions (see module docstring)."
        ),
    }, ARTIFACTS / "m2_metrics.json")

    print(f"[m2] component_clf: {clf['metrics']}")
    print(f"[m2] progress_reg: {reg['metrics']}")
    if benchmark:
        print("[m2] AI4I benchmark table:")
        for row in benchmark:
            print(f"  {row['model']:<20} acc={row['accuracy']:.4f}  f1={row['f1']:.4f}")
    print(f"[m2] artifacts written to {ARTIFACTS}")


if __name__ == "__main__":
    main()
