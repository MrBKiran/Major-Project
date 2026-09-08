"""
Manufacturing Quality Insights Module — the aftersales → production feedback
loop (PROJECT_PLAN §8, Slide 4).

Fleet-level, not per-VIN: it runs over the whole service history rather than
inside a single vehicle's run, so it has its own entry point rather than a node
in the per-vehicle graph.

Flow: aggregate failures → find statistically significant clusters → retrieve
matching historical CAPAs → draft a grounded ticket → hand to the plant.

`notify.plant` is deliberately NOT called automatically. It is side_effect=
irreversible, and telling a manufacturing team to inspect a batch starts a real
recall process — that stays a human decision. The agent prepares the ticket and
stops.
"""

from __future__ import annotations

from app.graph.state import FleetState
from app.tools.registry import ToolBlocked, ToolContext, invoke

AGENT_ID = "mfg_quality_agent"

# Only clusters that survive multiple-comparison correction are drafted. A
# cohort that merely crosses p<0.05 among dozens tested is the expected false
# positive, and a spurious recall costs more than the failures it chases.
REQUIRE_FDR = True


async def run(state: FleetState) -> FleetState:
    ctx = ToolContext(run_id=state["run_id"], agent_id=AGENT_ID)

    try:
        await invoke(AGENT_ID, "maintenance.aggregate",
                      {"group_by": ["component", "batch_id", "plant"]}, ctx)
        clusters_result = await invoke(AGENT_ID, "defect.cluster", {"min_lift": 2.0}, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    clusters = (clusters_result.data or {}).get("clusters", [])
    actionable = [c for c in clusters if c["survives_fdr"]] if REQUIRE_FDR else clusters

    if not actionable:
        return {**state, "capa_insight": {
            "clusters_found": len(clusters), "actionable": 0,
            "note": "no cluster survived multiple-comparison correction",
        }, "completed": [*state.get("completed", []), "mfg_quality"]}

    top = actionable[0]
    try:
        draft = await invoke(AGENT_ID, "capa.draft", {
            "cluster_key": top["cluster_key"], "evidence": top,
        }, ctx)
    except ToolBlocked as e:
        return {**state, "halted": True, "halt_reason": f"UEBA blocked {AGENT_ID}: {e}"}

    return {
        **state,
        "capa_insight": {
            "clusters_found": len(clusters),
            "actionable": len(actionable),
            "top_cluster": top,
            "draft": draft.data,
            "awaiting_human_approval": True,   # notify.plant is not auto-sent
        },
        "completed": [*state.get("completed", []), "mfg_quality"],
    }


async def run_quality_analysis() -> dict:
    """Standalone fleet-wide entry point (no VIN scope)."""
    import uuid

    state: FleetState = {
        "run_id": f"mfg-{uuid.uuid4().hex[:8]}",
        "trigger": "scheduled_sweep",  # type: ignore[typeddict-item]
        "plan": [], "completed": [], "halted": False, "halt_reason": None,
    }
    result = await run(state)
    return result.get("capa_insight") or {}
