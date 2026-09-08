#!/usr/bin/env python3
"""One-time script to train and save all ML models"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from app.ml.models import build_and_save_models
import logging
logging.basicConfig(level=logging.INFO)
build_and_save_models()
print("Models built successfully.")
