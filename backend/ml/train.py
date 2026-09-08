"""
AutoSaarthi ML Training
M1: Health Classifier (LightGBM)
M2: Failure Predictor (XGBoost)
M3: Demand Forecaster (Prophet)
M4: Anomaly Detector (IsolationForest)
"""
import numpy as np
import pandas as pd
import joblib
import os
from pathlib import Path

MODEL_DIR = Path(__file__).parent.parent.parent / "data" / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def generate_synthetic_data(n=5000):
    np.random.seed(42)
    df = pd.DataFrame({
        "coolant_temp": np.random.normal(90, 15, n),
        "oil_pressure": np.random.normal(35, 8, n),
        "rpm": np.random.normal(2000, 500, n),
        "speed": np.random.normal(60, 20, n),
        "battery_voltage": np.random.normal(12.5, 0.5, n),
        "fuel_level": np.random.uniform(10, 100, n),
        "coolant_temp_trend_7d": np.random.normal(0, 2, n),
        "mileage": np.random.randint(10000, 150000, n),
        "dtc_count": np.random.randint(0, 5, n),
    })
    conditions = (
        (df["coolant_temp"] > 105) |
        (df["oil_pressure"] < 25) |
        (df["dtc_count"] > 3)
    )
    df["health_label"] = np.where(
        df["coolant_temp"] > 110, 3,
        np.where(conditions, 2,
        np.where(df["coolant_temp"] > 95, 1, 0))
    )
    df["failure_component"] = np.where(df["coolant_temp"] > 105, "Water Pump", "None")
    df["failure_prob"] = np.clip((df["coolant_temp"] - 85) / 40, 0, 1)
    df["days_to_failure"] = np.where(df["failure_prob"] > 0.5,
        np.random.randint(1, 14, n), np.random.randint(30, 90, n))
    return df


def train_health_classifier():
    from lightgbm import LGBMClassifier
    df = generate_synthetic_data()
    features = ["coolant_temp", "oil_pressure", "rpm", "speed",
                "battery_voltage", "fuel_level", "coolant_temp_trend_7d",
                "mileage", "dtc_count"]
    X, y = df[features], df["health_label"]
    model = LGBMClassifier(n_estimators=200, random_state=42)
    model.fit(X, y)
    path = MODEL_DIR / "m1_health_classifier.pkl"
    joblib.dump(model, path)
    print(f"✅ M1 saved: {path}")
    return model


def train_failure_predictor():
    from xgboost import XGBClassifier
    df = generate_synthetic_data()
    features = ["coolant_temp", "oil_pressure", "rpm", "speed",
                "battery_voltage", "fuel_level", "coolant_temp_trend_7d",
                "mileage", "dtc_count"]
    df["failure_binary"] = (df["failure_prob"] > 0.5).astype(int)
    X, y = df[features], df["failure_binary"]
    model = XGBClassifier(n_estimators=200, random_state=42, eval_metric="logloss")
    model.fit(X, y)
    path = MODEL_DIR / "m2_failure_predictor.pkl"
    joblib.dump(model, path)
    print(f"✅ M2 saved: {path}")
    return model


def train_anomaly_detector():
    from sklearn.ensemble import IsolationForest
    df = generate_synthetic_data()
    features = ["coolant_temp", "oil_pressure", "rpm", "speed", "battery_voltage"]
    X = df[features]
    model = IsolationForest(contamination=0.05, random_state=42)
    model.fit(X)
    path = MODEL_DIR / "m4_anomaly_detector.pkl"
    joblib.dump(model, path)
    print(f"✅ M4 saved: {path}")
    return model


def train_demand_forecaster():
    """Train M3 demand forecaster using Prophet."""
    try:
        from prophet import Prophet
    except ImportError:
        print("Prophet not installed, skipping M3")
        return None
    df = pd.DataFrame({
        "ds": pd.date_range("2023-01-01", periods=365, freq="D"),
        "y": np.random.poisson(15, 365) + np.sin(np.linspace(0, 2*np.pi, 365)) * 3
    })
    model = Prophet(yearly_seasonality=True, weekly_seasonality=True)
    model.fit(df)
    path = MODEL_DIR / "m3_demand_forecaster.pkl"
    joblib.dump(model, path)
    print(f"✅ M3 saved: {path}")
    return model


if __name__ == "__main__":
    print("🚀 Training AutoSaarthi ML models...")
    train_health_classifier()
    train_failure_predictor()
    train_anomaly_detector()
    train_demand_forecaster()
    print("✅ All models trained successfully!")
