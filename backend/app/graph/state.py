"""FleetState — shared state threaded through the Master Agent's LangGraph
StateGraph. Matches PROJECT_PLAN.md §5.1 exactly."""

from __future__ import annotations

from typing import Literal, TypedDict


class FleetState(TypedDict, total=False):
    run_id: str
    vin: str
    trigger: Literal["telemetry_alert", "scheduled_sweep", "manual", "fleet_request"]
    telemetry_window: list[dict]
    health: dict | None
    diagnosis: dict | None
    demand_forecast: dict | None
    customer: dict
    conversation: list[dict]
    intent_to_book: bool
    objections_handled: int
    offered_slots: list[dict]
    booking: dict | None
    service_status: str | None
    feedback: dict | None
    capa_insight: dict | None
    # --- governance ---
    plan: list[str]
    completed: list[str]
    ueba_events: list[dict]
    risk_score: float
    halted: bool
    halt_reason: str | None
