"""
DEMO_MODE / final-fallback text for app.llm.router.complete().

Persuasion strategy templates are loaded from config/strategies.yaml so there
is exactly one place that defines what each named strategy says — the
Customer Engagement Agent's strategy *selection* logic lives in
app/graph/nodes/customer_engagement.py, this module only owns the *text*.
"""

from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
STRATEGIES_PATH = ROOT / "config" / "strategies.yaml"

_doc = yaml.safe_load(STRATEGIES_PATH.read_text(encoding="utf-8"))

FIXTURES: dict[str, str] = {
    f"persuade.{name}": spec["template"]
    for name, spec in _doc["strategies"].items()
}
FIXTURES.update({
    "master.plan_rationale": (
        "{vin}: classify current health, then diagnose component risk from the "
        "live telemetry window."
    ),
    "master.plan_feedback": (
        "{vin}: service closed — call the owner for satisfaction, then write the "
        "completed work back onto the vehicle record."
    ),
    "master.replan_booking": (
        "{vin}: owner said yes — extending the plan to allow scheduler.confirm "
        "so a real booking can be made for this run."
    ),
})

STRATEGY_ORDER = {name: spec["order"] for name, spec in _doc["strategies"].items()}
OBJECTIONS = _doc["objections"]
DEFAULT_OBJECTION_COUNTER = _doc["default_objection_counter"]


def classify_objection(utterance: str) -> tuple[str, str | None]:
    """Match an owner's reply to (counter_strategy, revealed_constraint).

    Deterministic — used in DEMO_MODE and as the fallback when the LLM router
    can't reach a provider, so the Customer Engagement Agent never stalls.
    The constraint (e.g. "weekend_only") lets the caller re-rank slots before
    answering; None means the reply revealed no scheduling restriction.
    """
    text = utterance.lower()
    for obj in OBJECTIONS:
        if any(kw in text for kw in obj["keywords"]):
            return obj["counter_strategy"], obj.get("constraint")
    return DEFAULT_OBJECTION_COUNTER, None
