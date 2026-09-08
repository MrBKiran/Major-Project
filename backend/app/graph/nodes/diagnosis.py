"""Diagnosis Agent — runs M2 component-failure prediction, grounds it against
repair history and DTC lookups.

Per PROJECT_PLAN §5.3: health + telemetry → ranked component risks,
days-to-failure, P1/P2/P3, evidence chain.
"""

from __future__ import annotations

from app.graph.state import FleetState
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "diagnosis_agent"


async def run(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID, vin=state["vin"])

    try:
        prediction = await invoke(
            AGENT_ID, "ml.predict_component_failure", {"vin": state["vin"], "minutes": 1440}, ctx
        )
        history = await invoke(AGENT_ID, "maintenance.read_history", {"vin": state["vin"]}, ctx)

        dtc_codes: list[str] = []
        for row in reversed(state.get("telemetry_window") or []):
            if row.get("dtc_codes"):
                dtc_codes = row["dtc_codes"]
                break
        dtc_hits = []
        for code in dtc_codes[:3]:
            r = await invoke(AGENT_ID, "dtc.lookup", {"code": code}, ctx)
            if r.data and not r.data.get("error"):
                dtc_hits.append(r.data)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    predictions = (prediction.data or {}).get("predictions", [])
    evidence = [f"{len(history.data.get('records', []))} prior service record(s) on file"] if history.ok else []
    evidence += [f"{d['code']}: {d['description']}" for d in dtc_hits]

    diagnosis = {
        "predictions": predictions,
        "top": predictions[0] if predictions else None,
        "evidence": evidence,
    }

    # Persist, so the prediction outlives this run: M3's demand forecast counts
    # these as jobs about to arrive, and the fleet dashboard reads current risk
    # from here rather than re-running inference per page load.
    # Written unconditionally — an empty list is a meaningful result, and is
    # what clears a vehicle that is no longer at risk.
    try:
        await invoke(AGENT_ID, "predictions.write",
                      {"vin": state["vin"], "predictions": predictions}, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "diagnosis": diagnosis,
        "completed": [*state.get("completed", []), "diagnosis"],
    }
