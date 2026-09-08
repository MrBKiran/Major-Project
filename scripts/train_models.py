#!/usr/bin/env python3
"""
Run this once to train all 4 ML models before starting the backend.
  python scripts/train_models.py
"""
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from ml.train import (
    train_health_classifier,
    train_failure_predictor,
    train_anomaly_detector,
    train_demand_forecaster,
)

if __name__ == "__main__":
    print("=" * 50)
    print("AutoSaarthi – ML Model Training")
    print("=" * 50)
    train_health_classifier()
    train_failure_predictor()
    train_anomaly_detector()
    train_demand_forecaster()
    print("=" * 50)
    print("✅ All models trained. You can now start the backend.")
