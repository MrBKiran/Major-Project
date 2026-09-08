"""Shared helpers for the M1/M2 training scripts."""

from __future__ import annotations

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd
from sklearn.metrics import ConfusionMatrixDisplay, confusion_matrix

ROOT = Path(__file__).resolve().parents[2]
DATA_PATH = ROOT / "data" / "synthetic" / "vehicle_training_set.csv"
ARTIFACTS = ROOT / "ml" / "artifacts"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def load_training_frame() -> pd.DataFrame:
    if not DATA_PATH.exists():
        raise FileNotFoundError(
            f"{DATA_PATH} not found — run `python ml/train/generate_dataset.py` first."
        )
    return pd.read_csv(DATA_PATH)


def feature_columns(df: pd.DataFrame) -> list[str]:
    cols = [c for c in df.columns if c.endswith(("_mean", "_std", "_slope"))]
    cols += ["odometer_km", "dtc_count"]
    return cols


def save_confusion_matrix(y_true, y_pred, labels: list[str], path: Path, title: str) -> None:
    cm = confusion_matrix(y_true, y_pred, labels=labels)
    disp = ConfusionMatrixDisplay(confusion_matrix=cm, display_labels=labels)
    fig, ax = plt.subplots(figsize=(6, 6))
    disp.plot(ax=ax, xticks_rotation=45, colorbar=False)
    ax.set_title(title)
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)


def save_json(obj: dict, path: Path) -> None:
    path.write_text(json.dumps(obj, indent=2, default=str), encoding="utf-8")
