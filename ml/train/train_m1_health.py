"""
M1 — Vehicle Health Classifier (4-class: Excellent/Good/Needs Service/Critical).

Basis: "Predictive Vehicle Maintenance using Deep Neural Networks" (Karunya, 2024).
Model choice: LightGBM (beats their DNN in wall-clock, and is SHAP-explainable
out of the box) with a LogReg/DT/RF/SVM/KNN/XGBoost comparison table alongside
it — mirrors how the reference papers present results (PROJECT_PLAN §4).

Run:  cd ml/train && ../../.venv/Scripts/python.exe train_m1_health.py
"""

from __future__ import annotations

import gc

import joblib
import lightgbm as lgb
import numpy as np
import pandas as pd
import shap
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import train_test_split
from sklearn.neighbors import KNeighborsClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.svm import SVC
from sklearn.tree import DecisionTreeClassifier
import xgboost as xgb
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score

from common import ARTIFACTS, feature_columns, load_training_frame, save_confusion_matrix, save_json

CLASSES = ["Excellent", "Good", "Needs Service", "Critical"]


def main() -> None:
    df = load_training_frame()
    feats = feature_columns(df)
    X = df[feats].fillna(0.0)
    y = df["health_class"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    scaler = StandardScaler().fit(X_train)
    X_train_s = scaler.transform(X_train)
    X_test_s = scaler.transform(X_test)

    # Trimmed ensemble sizes — this machine runs low on free RAM (~500MB-1GB
    # free out of 7.6GB total with Docker + IDE + browser also running), and
    # even these tiny (936-row) fits were hitting "bad allocation" errors at
    # the default sklearn/xgboost/lightgbm estimator counts. 120 trees is
    # still plenty for a dataset this size.
    def make_candidates():
        return {
            "LogisticRegression": LogisticRegression(max_iter=2000),
            "DecisionTree": DecisionTreeClassifier(max_depth=8, random_state=42),
            "RandomForest": RandomForestClassifier(n_estimators=120, max_depth=10, random_state=42),
            "SVM": SVC(kernel="rbf", probability=True, random_state=42),
            "KNN": KNeighborsClassifier(n_neighbors=15),
            "XGBoost": xgb.XGBClassifier(
                n_estimators=120, max_depth=5, learning_rate=0.1,
                objective="multi:softprob", eval_metric="mlogloss", random_state=42,
            ),
            "LightGBM": lgb.LGBMClassifier(
                n_estimators=120, max_depth=6, learning_rate=0.1, random_state=42, verbosity=-1
            ),
        }

    # SHAP's TreeExplainer needs a tree model, and XGBoost here is fitted on
    # integer-encoded labels (so its predict_proba column order differs from the
    # string-label models). Restrict serving candidates to string-label trees and
    # pick the genuinely best one by macro-F1 rather than hardcoding a winner.
    SERVING_CANDIDATES = {"RandomForest", "DecisionTree", "LightGBM"}

    fitted: dict = {}
    comparison = []
    for name, model in make_candidates().items():
        # tree ensembles don't need scaling; linear/SVM/KNN do
        use_scaled = name in ("LogisticRegression", "SVM", "KNN")
        xt, xv = (X_train_s, X_test_s) if use_scaled else (X_train, X_test)

        if name in ("XGBoost",):
            le = {c: i for i, c in enumerate(CLASSES)}
            model.fit(xt, y_train.map(le))
            pred = pd.Series(model.predict(xv)).map({i: c for c, i in le.items()})
        else:
            model.fit(xt, y_train)
            pred = model.predict(xv)

        comparison.append({
            "model": name,
            "accuracy": round(accuracy_score(y_test, pred), 4),
            "precision_macro": round(precision_score(y_test, pred, average="macro", zero_division=0), 4),
            "recall_macro": round(recall_score(y_test, pred, average="macro", zero_division=0), 4),
            "f1_macro": round(f1_score(y_test, pred, average="macro", zero_division=0), 4),
        })

        if name in SERVING_CANDIDATES:
            fitted[name] = model
        else:
            del model
        gc.collect()

    best_name = max(
        (r for r in comparison if r["model"] in SERVING_CANDIDATES),
        key=lambda r: r["f1_macro"],
    )["model"]
    best_model = fitted[best_name]
    best_pred = best_model.predict(X_test)

    save_confusion_matrix(
        y_test, best_pred, CLASSES,
        ARTIFACTS / "m1_confusion_matrix.png",
        f"M1 Health Classifier — {best_name}",
    )

    # SHAP top features (tree explainer — fast, exact for tree models)
    explainer = shap.TreeExplainer(best_model)
    shap_values = explainer.shap_values(X_test.iloc[:200])
    if isinstance(shap_values, list):
        mean_abs = np.mean([np.abs(sv).mean(axis=0) for sv in shap_values], axis=0)
    else:
        mean_abs = np.abs(shap_values).mean(axis=(0, 2)) if shap_values.ndim == 3 else np.abs(shap_values).mean(axis=0)
    top_idx = np.argsort(mean_abs)[::-1][:10]
    shap_top = [{"feature": feats[i], "mean_abs_shap": round(float(mean_abs[i]), 5)} for i in top_idx]

    # `classes` MUST be the model's own class order, not the CLASSES constant:
    # sklearn/LightGBM sort string labels alphabetically, so predict_proba
    # columns come back as Critical/Excellent/Good/Needs Service. Mapping those
    # onto the severity-ordered CLASSES list silently relabels every prediction.
    joblib.dump({"model": best_model, "scaler": None, "features": feats,
                 "classes": list(best_model.classes_)},
                ARTIFACTS / "m1_health_classifier.joblib")

    save_json({
        "model": best_name,
        "classes": CLASSES,
        "n_train": len(X_train), "n_test": len(X_test),
        "comparison_table": sorted(comparison, key=lambda r: -r["accuracy"]),
        "shap_top_features": shap_top,
    }, ARTIFACTS / "m1_metrics.json")

    print(f"[m1] best={best_name}")
    for row in sorted(comparison, key=lambda r: -r["accuracy"]):
        print(f"  {row['model']:<20} acc={row['accuracy']:.4f}  f1_macro={row['f1_macro']:.4f}")
    print(f"[m1] artifacts written to {ARTIFACTS}")


if __name__ == "__main__":
    main()
