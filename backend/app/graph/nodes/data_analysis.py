"""Data Analysis Agent — reads telemetry + history, runs M1 health classification.

Per PROJECT_PLAN §5.3: tools = telemetry.read_window, maintenance.read_history,
ml.health_classify, ml.forecast_demand, ml.detect_anomaly. This skeleton wires
the first three (M3/M4 aren't trained yet); forecast/anomaly stay stubbed and
can be added to `run()` without touching the graph shape.

Every capability goes through `registry.invoke()` — never a direct import of
another module's function. That is what makes UEBA non-bypassable.
"""

from __future__ import annotations

from app.graph.state import FleetState
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "data_analysis_agent"


async def run(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])

    try:
        window = await invoke(AGENT_ID, "telemetry.read_window", {"vin": state["vin"], "minutes": 1440}, ctx)
        health = await invoke(AGENT_ID, "ml.health_classify", {"vin": state["vin"], "minutes": 1440}, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "telemetry_window": (window.data or {}).get("rows", []),
        "health": health.data,
        "completed": [*state.get("completed", []), "data_analysis"],
    }
