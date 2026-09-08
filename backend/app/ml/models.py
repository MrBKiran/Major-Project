"""
ML Models: Health Classifier (M1), Failure Predictor (M2),
Demand Forecaster (M3), Anomaly Detector (M4)
"""
import os, joblib, logging
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from app.config import get_settings

settings = get_settings()
logger = logging.getLogger("ml")

# ── Synthetic training data & model builders ──────────────────────────────────

def _make_health_features(n=2000):
    rng = np.random.default_rng(42)
    df = pd.DataFrame({
        "coolant_temp": rng.normal(90, 15, n),
        "oil_pressure": rng.normal(35, 8, n),
        "battery_voltage": rng.normal(12.4, 0.5, n),
        "engine_load": rng.normal(55, 20, n),
        "rpm": rng.normal(2200, 600, n),
        "speed": rng.normal(50, 25, n),
        "fuel_level": rng.uniform(10, 100, n),
        "dtc_count": rng.integers(0, 4, n),
    })
    def label(row):
        score = 0
        if row.coolant_temp > 105: score += 2
        if row.oil_pressure < 25: score += 2
        if row.battery_voltage < 11.8: score += 1
        if row.dtc_count > 1: score += 2
        if score == 0: return 0  # Excellent
        if score == 1: return 1  # Good
        if score <= 3: return 2  # Needs Service
        return 3  # Critical
    df["label"] = df.apply(label, axis=1)
    return df

def _make_failure_features(n=2000):
    rng = np.random.default_rng(7)
    df = pd.DataFrame({
        "coolant_temp_trend": rng.normal(0.5, 1.5, n),
        "oil_pressure_trend": rng.normal(-0.1, 0.5, n),
        "battery_trend": rng.normal(-0.01, 0.05, n),
        "coolant_temp_max": rng.normal(95, 12, n),
        "oil_pressure_min": rng.normal(32, 7, n),
        "dtc_count_7d": rng.integers(0, 6, n),
        "age_days": rng.integers(100, 3000, n),
        "km_since_service": rng.integers(0, 15000, n),
    })
    fail_prob = (
        (df.coolant_temp_trend > 1.5).astype(float) * 0.4 +
        (df.oil_pressure_trend < -0.3).astype(float) * 0.3 +
        (df.dtc_count_7d > 2).astype(float) * 0.3
    )
    df["failure"] = (fail_prob + rng.normal(0, 0.1, n) > 0.4).astype(int)
    df["days_to_failure"] = np.where(df.failure == 1,
        rng.integers(1, 30, n), rng.integers(30, 180, n))
    return df

def build_and_save_models():
    import lightgbm as lgb
    import xgboost as xgb
    os.makedirs(settings.model_dir, exist_ok=True)

    # M1 – Health Classifier (LightGBM)
    df1 = _make_health_features()
    feat1 = ["coolant_temp","oil_pressure","battery_voltage","engine_load","rpm","speed","fuel_level","dtc_count"]
    m1 = lgb.LGBMClassifier(n_estimators=200, learning_rate=0.05, random_state=42)
    m1.fit(df1[feat1], df1["label"])
    joblib.dump({"model": m1, "features": feat1, "classes": ["Excellent","Good","Needs Service","Critical"]},
                f"{settings.model_dir}/m1_health.pkl")
    logger.info("M1 saved")

    # M2 – Failure Predictor (XGBoost)
    df2 = _make_failure_features()
    feat2 = ["coolant_temp_trend","oil_pressure_trend","battery_trend","coolant_temp_max",
             "oil_pressure_min","dtc_count_7d","age_days","km_since_service"]
    m2_cls = xgb.XGBClassifier(n_estimators=200, learning_rate=0.05, random_state=42, eval_metric="logloss")
    m2_cls.fit(df2[feat2], df2["failure"])
    m2_reg = xgb.XGBRegressor(n_estimators=200, learning_rate=0.05, random_state=42)
    m2_reg.fit(df2[feat2], df2["days_to_failure"])
    joblib.dump({"classifier": m2_cls, "regressor": m2_reg, "features": feat2},
                f"{settings.model_dir}/m2_failure.pkl")
    logger.info("M2 saved")

    # M4 – Anomaly Detector (IsolationForest)
    rng = np.random.default_rng(99)
    X_normal = rng.normal(0, 1, (1000, 8))
    m4 = IsolationForest(contamination=0.05, random_state=42)
    m4.fit(X_normal)
    joblib.dump(m4, f"{settings.model_dir}/m4_anomaly.pkl")
    logger.info("M4 saved")

    logger.info("All models built and saved.")

# ── Inference helpers ─────────────────────────────────────────────────────────

class MLService:
    def __init__(self):
        self._m1 = None
        self._m2 = None
        self._m4 = None

    def _load(self):
        p = settings.model_dir
        if not self._m1 and os.path.exists(f"{p}/m1_health.pkl"):
            self._m1 = joblib.load(f"{p}/m1_health.pkl")
        if not self._m2 and os.path.exists(f"{p}/m2_failure.pkl"):
            self._m2 = joblib.load(f"{p}/m2_failure.pkl")
        if not self._m4 and os.path.exists(f"{p}/m4_anomaly.pkl"):
            self._m4 = joblib.load(f"{p}/m4_anomaly.pkl")

    def predict_health(self, telem: dict) -> dict:
        self._load()
        if not self._m1:
            return {"class": "Unknown", "probabilities": {}}
        feat = self._m1["features"]
        X = pd.DataFrame([{f: telem.get(f, 0) for f in feat}])
        proba = self._m1["model"].predict_proba(X)[0]
        classes = self._m1["classes"]
        idx = int(proba.argmax())
        return {
            "class": classes[idx],
            "probabilities": {c: round(float(p), 3) for c, p in zip(classes, proba)}
        }

    def predict_failure(self, features: dict) -> dict:
        self._load()
        if not self._m2:
            return {"failure_probability": 0.0, "days_to_failure": 90, "severity": "P3"}
        feat = self._m2["features"]
        X = pd.DataFrame([{f: features.get(f, 0) for f in feat}])
        prob = float(self._m2["classifier"].predict_proba(X)[0][1])
        days = int(self._m2["regressor"].predict(X)[0])
        severity = "P1" if (prob > 0.7 and days < 7) else "P2" if prob > 0.4 else "P3"
        return {"failure_probability": round(prob, 3), "days_to_failure": days, "severity": severity}

    def anomaly_score(self, vector: list[float]) -> float:
        self._load()
        if not self._m4:
            return 0.0
        X = np.array(vector).reshape(1, -1)
        # Pad/trim to 8 features
        if X.shape[1] < 8:
            X = np.pad(X, ((0,0),(0, 8-X.shape[1])))
        else:
            X = X[:, :8]
        score = self._m4.score_samples(X)[0]
        # Normalise to 0–1 (lower = more anomalous)
        return round(float(1 - (score + 0.5)), 3)

    def demand_forecast(self, history: list[dict]) -> list[dict]:
        """Simple Prophet/SARIMAX stub – returns 14-day forecast."""
        import random, datetime
        base = 8
        forecast = []
        for i in range(14):
            day = (datetime.date.today() + datetime.timedelta(days=i+1)).isoformat()
            forecast.append({"date": day, "expected_demand": base + random.randint(-2, 5),
                             "overload": False})
        return forecast

ml_service = MLService()
