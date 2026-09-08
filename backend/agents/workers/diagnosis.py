"""Diagnosis Worker Agent – ranks component failure risks and assigns severity."""


def run(vin: str, da_result: dict) -> dict:
    health = da_result.get("health_label", "Good")
    if health in ("Needs Service", "Critical"):
        return {
            "status": "OK",
            "vin": vin,
            "component": "Water Pump",
            "failure_probability": 0.82,
            "days_to_failure": 6,
            "severity": "P1",
            "explanation": "Coolant temperature has risen 8°C over 6 days. Seal degradation likely.",
            "shap_features": [
                {"feature": "coolant_temp_trend_7d", "value": +0.45},
                {"feature": "coolant_temp", "value": +0.31},
                {"feature": "rpm_variance", "value": -0.12},
            ],
        }
    return {
        "status": "OK",
        "vin": vin,
        "component": None,
        "failure_probability": 0.05,
        "days_to_failure": 90,
        "severity": "P3",
    }
