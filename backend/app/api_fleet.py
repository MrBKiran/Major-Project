"""
Read APIs behind Slides 1-4.

Deliberately thin: every one of these reads what the agents already computed
and persisted, rather than triggering inference on request. A page load must
never be able to start an agent run — that would put the UI inside the UEBA
audit trail and make the security console show traffic the demo didn't cause.
The one exception is /runs/trigger, which is explicit and operator-initiated.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import text

from app import jobs
from app.api_common import Page, page_params
from app.auth.audit import record_principal
from app.auth.deps import requires
from app.auth.principal import Principal
from app.auth.scope import can_access_vin, vin_predicate
from app.db.session import engine

router = APIRouter(prefix="/api", tags=["fleet"])


# ── Slide 1: fleet monitoring + predictions ────────────────────────────────

@router.get("/fleet")
async def fleet(
    page: Page = Depends(page_params),
    principal: Principal = Depends(requires("vehicle:read")),
) -> dict:
    """Vehicles this principal is entitled to see, with current risk.

    The /*SCOPE*/ marker is replaced by the principal's row predicate — an OEM
    gets its own brands, a dealer group gets vehicles tied to its centres, an
    owner gets their own car. The query is never run unscoped.
    """
    scope = vin_predicate(principal)
    sql = text(scope.apply("""
        SELECT v.vin, v.model, v.city, v.batch_id, v.plant, v.odometer, v.oem,
               c.name AS owner, c.language,
               p.component, p.failure_prob, p.days_to_failure, p.severity,
               (SELECT COUNT(*) FROM telemetry t WHERE t.vin = v.vin) AS telemetry_rows
        FROM vehicles v
        LEFT JOIN customers c ON c.id = v.owner_id
        LEFT JOIN LATERAL (
            SELECT component, failure_prob, days_to_failure, severity
            FROM predictions
            WHERE vin = v.vin AND severity IS NOT NULL
            ORDER BY failure_prob DESC LIMIT 1
        ) p ON TRUE
        WHERE v.vin NOT LIKE 'HX%' AND (/*SCOPE*/)
        ORDER BY
            CASE p.severity WHEN 'P1' THEN 1 WHEN 'P2' THEN 2 WHEN 'P3' THEN 3 ELSE 4 END,
            p.failure_prob DESC NULLS LAST,
            v.vin
        LIMIT :limit OFFSET :offset
    """))
    count_sql = text(scope.apply(
        "SELECT COUNT(*) FROM vehicles v WHERE v.vin NOT LIKE 'HX%' AND (/*SCOPE*/)"
    ))
    with engine.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(
            sql, {**scope.params, "limit": page.limit, "offset": page.offset}).all()]
        total = conn.execute(count_sql, scope.params).scalar() or 0

    # Row scope decided which vehicles; redaction decides which columns. An OEM
    # quality engineer sees the failure, not the owner's name.
    rows = [principal.redact(r) for r in rows]

    record_principal(principal, "vehicle.list", subject=None, count=len(rows))
    if principal.can("customer_pii:read") and rows:
        record_principal(principal, "customer_pii.read", count=len(rows))

    return {
        "vehicles": rows,
        # Counts describe THIS page; `page.total` is the full scoped set. Naming
        # a page-local count "total" would understate the fleet the moment
        # anyone pages past the first 50.
        "page_counts": {
            "at_risk": sum(1 for r in rows if r["severity"]),
            "p1": sum(1 for r in rows if r["severity"] == "P1"),
            "healthy": sum(1 for r in rows if not r["severity"]),
        },
        "page": page.envelope(rows, total),
        "scope": {"kind": principal.scope_kind, "org": principal.org_name},
    }


@router.get("/vehicle/{vin}")
async def vehicle_detail(
    vin: str, minutes: int = 240,
    principal: Principal = Depends(requires("vehicle:read")),
) -> dict:
    """One vehicle: profile, telemetry series for the chart, predictions, history."""
    from app.db.queries import maintenance_history, telemetry_window, vehicle_info

    # 404 rather than 403 for an out-of-scope VIN: a 403 would confirm the
    # vehicle exists, letting one dealer probe another's roster by VIN.
    if not await asyncio.to_thread(can_access_vin, principal, vin):
        # Denied reads are logged too: a burst of them from one principal is
        # what a VIN-enumeration attempt looks like.
        record_principal(principal, "vehicle.read_one", subject=vin, outcome="denied")
        raise HTTPException(404, f"unknown vin {vin}")
    record_principal(principal, "vehicle.read_one", subject=vin)

    info = await asyncio.to_thread(vehicle_info, vin)
    if not info:
        raise HTTPException(404, f"unknown vin {vin}")

    df = await asyncio.to_thread(telemetry_window, vin, minutes)
    history = await asyncio.to_thread(maintenance_history, vin, 10)

    with engine.connect() as conn:
        preds = [dict(r._mapping) for r in conn.execute(
            text("SELECT component, failure_prob, days_to_failure, severity, ts "
                 "FROM predictions WHERE vin = :v ORDER BY failure_prob DESC"),
            {"v": vin},
        ).all()]

    series = []
    if not df.empty:
        # Thin to ~200 points: enough to render the degradation ramp, small
        # enough that the chart payload stays light.
        step = max(1, len(df) // 200)
        for _, row in df.iloc[::step].iterrows():
            series.append({
                "ts": row["ts"].isoformat(),
                "coolant_temp": row["coolant_temp"],
                "lub_oil_pressure": row["lub_oil_pressure"],
                "battery_voltage": row["battery_voltage"],
                "fuel_pressure": row["fuel_pressure"],
                "brake_fluid_pct": row["brake_fluid_pct"],
                "speed": row["speed"],
                "drive_state": row["drive_state"],
            })

    latest_dtcs = []
    if not df.empty:
        for codes in reversed(df["dtc_codes"].tolist()):
            if codes:
                latest_dtcs = list(codes)
                break

    # technician_notes can carry customer detail, so history is redacted the
    # same way the fleet list is.
    return {"vehicle": info, "series": series, "predictions": preds,
            "maintenance_history": [principal.redact(h) for h in history],
            "dtc_codes": latest_dtcs}


@router.get("/models/metrics")
async def model_metrics(_p: Principal = Depends(requires("prediction:read"))) -> dict:
    """M1/M2/M4 metrics as written by the training scripts — the Slide 1
    comparison table. Served from disk so the slide always matches the
    artifacts actually in use."""
    import json
    from pathlib import Path

    artifacts = Path(__file__).resolve().parents[2] / "ml" / "artifacts"
    out: dict = {}
    for name in ("m1_metrics", "m2_metrics", "m4_metrics"):
        p = artifacts / f"{name}.json"
        if p.exists():
            out[name] = json.loads(p.read_text(encoding="utf-8"))
    return out


# ── Slide 3: in-car console safety demo ─────────────────────────────────────
#
# The only Slide-3 endpoint, and deliberately a POST like /runs/trigger (see
# module docstring): it is explicit and operator-initiated, not something a
# page load can fire, because it puts real activity into the UEBA audit trail.
#
# It does not simulate the G6/G7 safety rules — it invokes the actual
# console.* tools through the real registry and guard, exactly like a live
# customer_engagement_agent would, with the caller's chosen drive_state
# carried on ToolContext (the same field the server treats as sole authority
# on drive state everywhere else). Whatever decision comes back is the
# decision the production system would have made.

class ConsoleDemoRequest(BaseModel):
    vin: str
    drive_state: Literal["IGNITION_OFF", "PARKED", "STOPPED_BRIEF", "DRIVING"] = "PARKED"
    speed_kmph: float = 0.0


@router.post("/console/demo")
async def console_demo(
    req: ConsoleDemoRequest,
    principal: Principal = Depends(requires("vehicle:read")),
) -> dict:
    from app.tools.registry import ToolBlocked, ToolContext, invoke
    # Aliased: module-level `engine` in this file is the SQLAlchemy engine.
    from app.ueba.policy import engine as ueba

    if not await asyncio.to_thread(can_access_vin, principal, req.vin):
        record_principal(principal, "console.demo", subject=req.vin, outcome="denied")
        raise HTTPException(404, f"unknown vin {req.vin}")
    record_principal(principal, "console.demo", subject=req.vin, drive_state=req.drive_state)

    with engine.connect() as conn:
        pred = conn.execute(
            text("SELECT component, severity, days_to_failure FROM predictions "
                 "WHERE vin = :v AND severity IS NOT NULL ORDER BY failure_prob DESC LIMIT 1"),
            {"v": req.vin},
        ).first()

    agent_id = "customer_engagement_agent"
    was_quarantined = ueba.scope.is_quarantined(agent_id)
    ctx = ToolContext(
        run_id=f"console-{uuid.uuid4().hex[:6]}", agent_id=agent_id, vin=req.vin,
        drive_state=req.drive_state, speed_kmph=req.speed_kmph,
    )
    steps: list[dict] = []

    async def attempt(tool_name: str, args: dict) -> bool:
        try:
            r = await invoke(agent_id, tool_name, args, ctx)
            steps.append({"tool": tool_name, "decision": r.decision, "ok": r.ok})
            return r.decision == "ALLOW"
        except ToolBlocked as e:
            steps.append({"tool": tool_name, "decision": "BLOCK",
                          "risk": round(e.risk, 3), "reasons": e.reasons})
            return False

    if not pred:
        return {"vin": req.vin, "drive_state": req.drive_state, "speed_kmph": req.speed_kmph,
                "prediction": None, "steps": []}

    alert_ok = await attempt("console.show_alert", {
        "vin": req.vin, "severity": pred.severity, "component": pred.component,
        "headline": f"{pred.component.replace('_', ' ').title()} may need service soon",
        "days_to_failure": round(pred.days_to_failure) if pred.days_to_failure is not None else None,
        "elements": 1,
    })

    if alert_ok:
        await attempt("console.show_slots", {
            "vin": req.vin,
            "slots": [{"label": "Tomorrow, 10:00 AM"}, {"label": "Thu, 2:00 PM"}, {"label": "Fri, 11:30 AM"}],
        })
        await attempt("console.request_touch", {
            "vin": req.vin, "prompt": "Book a slot for this service?", "options": ["Yes", "Not now"],
        })

    # This endpoint deliberately attempts the calls G6 forbids in motion — that
    # attempt IS the demonstration. But a BLOCK quarantines the agent, so a
    # single "Driving" simulation would otherwise leave the shared engagement
    # agent frozen for the whole quarantine window, and the next "Parked" run
    # would show an empty screen for a reason that has nothing to do with drive
    # state. Release what this harness itself caused, and only that: if the
    # agent was already quarantined on the way in, leave it alone, because that
    # one is a real finding somebody still has to clear.
    if not was_quarantined and ueba.scope.is_quarantined(agent_id):
        ueba.release(agent_id)
        steps.append({"tool": "-", "decision": "RELEASED",
                      "note": "simulated block — quarantine cleared so the demo stays repeatable"})

    return {
        "vin": req.vin, "drive_state": req.drive_state, "speed_kmph": req.speed_kmph,
        "prediction": {"component": pred.component, "severity": pred.severity,
                       "days_to_failure": pred.days_to_failure},
        "steps": steps,
    }


# ── Slide 2: demand forecast + capacity ────────────────────────────────────

@router.get("/forecast")
async def forecast(center_id: str | None = None, horizon_days: int = 14,
                    _p: Principal = Depends(requires("forecast:read"))) -> dict:
    from app.ml.forecast import forecast_center, forecast_fleet

    if center_id:
        return await asyncio.to_thread(forecast_center, center_id, horizon_days)
    return await asyncio.to_thread(forecast_fleet, horizon_days)


@router.get("/centers")
async def centers(_p: Principal = Depends(requires("vehicle:read"))) -> dict:
    with engine.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(text(
            "SELECT id, name, city, bays, daily_capacity, skills "
            "FROM service_centers ORDER BY city, id")).all()]
    return {"centers": rows}


@router.get("/appointments")
async def appointments(
    page: Page = Depends(page_params),
    principal: Principal = Depends(requires("appointment:read")),
) -> dict:
    scope = vin_predicate(principal)
    sql = text(scope.apply("""
        SELECT a.id, a.vin, a.center_id, a.slot_start, a.status,
               a.created_by_agent, sc.name AS center_name, v.model
        FROM appointments a
        JOIN service_centers sc ON sc.id = a.center_id
        JOIN vehicles v ON v.vin = a.vin
        WHERE (/*SCOPE*/)
        ORDER BY a.slot_start DESC, a.id
        LIMIT :limit OFFSET :offset
    """))
    with engine.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(
            sql, {**scope.params, "limit": page.limit, "offset": page.offset}).all()]
    return {"appointments": [principal.redact(r) for r in rows],
            "page": page.envelope(rows)}


# ── Slide 4: manufacturing quality ─────────────────────────────────────────

def _quality_brands(principal: Principal) -> list[str] | None:
    """Brands a principal may see quality analysis for.

    None means unrestricted and is returned ONLY for a genuinely fleet-wide
    scope. Any brand-scoped org gets its own marques; an org with no brands
    gets an impossible filter rather than everything, so a misconfigured tenant
    fails closed.
    """
    if principal.is_unrestricted:
        return None
    return principal.brands or ["__none__"]


@router.get("/quality/clusters")
async def quality_clusters(min_lift: float = 2.0,
                            principal: Principal = Depends(requires("quality:read"))) -> dict:
    from app.rca.cluster import find_clusters

    brands = _quality_brands(principal)
    record_principal(principal, "quality.read", subject=str(brands))
    clusters = await asyncio.to_thread(find_clusters, None, min_lift, 5, 0.05, brands)
    return {"analysed_brands": brands or "all",
            "clusters": clusters,
            "actionable": [c for c in clusters if c["survives_fdr"]]}


@router.get("/quality/capa-draft")
async def quality_capa_draft(
    principal: Principal = Depends(requires("capa:draft")),
) -> dict:
    """Full Slide 4 payload: the top actionable cluster plus its drafted ticket."""
    from app.rca.cluster import find_clusters
    from app.rca.draft import draft_capa

    brands = _quality_brands(principal)
    record_principal(principal, "capa.draft", subject=str(brands))
    clusters = await asyncio.to_thread(find_clusters, None, 2.0, 5, 0.05, brands)
    actionable = [c for c in clusters if c["survives_fdr"]]
    if not actionable:
        return {"cluster": None, "draft": None,
                "note": "no cluster survived multiple-comparison correction"}

    top = actionable[0]
    draft = await asyncio.to_thread(draft_capa, top)
    return {"cluster": top, "draft": draft, "clusters_screened": len(clusters)}


@router.get("/quality/capa-draft.pdf")
async def quality_capa_draft_pdf(
    principal: Principal = Depends(requires("capa:draft")),
) -> Response:
    """The current CAPA draft as a downloadable PDF.

    Goes through the tool registry rather than calling the renderer directly:
    `report.render_pdf` is a `write` side-effect the UEBA policy has an opinion
    about, and a download route that quietly bypassed the guard would be a
    second way to produce the same artefact with no audit entry.

    The payload is assembled HERE, from data this principal is already scoped
    to read — the renderer itself fetches nothing (see app/reports.py).
    """
    from app.rca.cluster import find_clusters
    from app.rca.draft import draft_capa
    from app.tools.registry import ToolBlocked, ToolContext, invoke

    brands = _quality_brands(principal)
    clusters = await asyncio.to_thread(find_clusters, None, 2.0, 5, 0.05, brands)
    actionable = [c for c in clusters if c["survives_fdr"]]
    if not actionable:
        raise HTTPException(404, "no cluster survived multiple-comparison correction")

    top = actionable[0]
    draft = await asyncio.to_thread(draft_capa, top)
    record_principal(principal, "capa.render_pdf", subject=draft["capa_id"])

    ev = draft.get("evidence") or {}
    payload = {
        "capa_id": draft["capa_id"],
        "component": draft["component"],
        "defect_mode": (f"{draft['component'].replace('_', ' ')} failures in "
                        f"{draft['batch_id']} at {ev.get('lift', 0):.1f}x the fleet baseline"),
        "batch_id": draft["batch_id"],
        "plant": draft["plant"],
        "status": draft.get("status", "draft"),
        "affected_count": ev.get("failures"),
        "root_cause": (f"{ev.get('failures')} of {ev.get('cohort_size')} units failed "
                       f"({ev.get('failure_rate', 0):.1%} vs {ev.get('baseline_rate', 0):.1%} "
                       f"baseline, p={ev.get('p_value'):.4g}, q={ev.get('q_value'):.4g}). "
                       f"Confidence: {draft.get('confidence')}."),
        "corrective_action": draft.get("recommended_corrective"),
        "preventive_action": draft.get("recommended_preventive"),
        "five_why": draft.get("five_why"),
    }

    ctx = ToolContext(run_id=f"capa-{uuid.uuid4().hex[:6]}",
                      agent_id="mfg_quality_agent")
    try:
        res = await invoke("mfg_quality_agent", "report.render_pdf",
                           {"kind": "capa", "payload": payload}, ctx)
    except ToolBlocked as e:
        raise HTTPException(403, f"UEBA blocked the render: {e}")

    path = (res.data or {}).get("path")
    if not path:
        raise HTTPException(500, (res.data or {}).get("error") or "render failed")

    from pathlib import Path as _P
    data = await asyncio.to_thread(_P(path).read_bytes)
    return Response(
        content=data, media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{draft["capa_id"]}.pdf"'},
    )


@router.get("/capa/{capa_id}")
async def capa_document(capa_id: str,
                         principal: Principal = Depends(requires("quality:read"))) -> dict:
    """A cited historical CAPA — so the 5-Why citations are clickable.

    The corpus is not brand-tagged (historical CAPAs predate the tenancy model),
    so this is restricted to principals whose quality scope is unrestricted or
    who reached it from their own cluster. Brand-scoped orgs get the documents
    their own analysis cited, and nothing else.
    """
    from app.rca.corpus import _load_corpus

    docs, _, _ = await asyncio.to_thread(_load_corpus)
    doc = next((d for d in docs if d["capa_id"] == capa_id), None)
    if doc is None:
        raise HTTPException(404, f"unknown capa {capa_id}")

    brands = _quality_brands(principal)
    if brands is not None:
        cited = await asyncio.to_thread(_cited_capa_ids_for, brands)
        if capa_id not in cited:
            raise HTTPException(404, f"unknown capa {capa_id}")
    return doc


def _cited_capa_ids_for(brands: list[str]) -> set[str]:
    """CAPA ids reachable from this brand's own clusters."""
    from app.rca.cluster import find_clusters
    from app.rca.draft import draft_capa

    ids: set[str] = set()
    for c in find_clusters(None, 2.0, 5, 0.05, brands):
        ids.update(draft_capa(c).get("cited_capa_ids") or [])
    return ids


# ── agent runs ─────────────────────────────────────────────────────────────

@router.get("/runs")
async def runs(page: Page = Depends(page_params),
                _p: Principal = Depends(requires("agent:trigger"))) -> dict:
    with engine.connect() as conn:
        rows = [dict(r._mapping) for r in conn.execute(text(
            "SELECT run_id, vin, trigger, started_at, ended_at, outcome "
            "FROM agent_runs ORDER BY started_at DESC, run_id "
            "LIMIT :limit OFFSET :offset"),
            {"limit": page.limit, "offset": page.offset}).all()]
    return {"runs": rows, "page": page.envelope(rows)}


class TriggerRequest(BaseModel):
    vin: str
    trigger: str = "manual"
    # The live demo wants the result inline; production callers should not hold
    # a connection open for a multi-second agent run.
    wait: bool = False


@router.post("/runs/trigger", status_code=202)
async def trigger_run(
    req: TriggerRequest,
    response: Response,
    principal: Principal = Depends(requires("agent:trigger")),
) -> dict:
    """Start a Master-graph run for one VIN.

    Returns 202 + a job id by default: the run does inference, several DB round
    trips and (soon) a voice call, and pinning an HTTP worker for that does not
    scale. Poll /api/runs/job/{id} or watch /ws/events.

    Scope is checked here as well as inside the graph: agent_policy.yaml governs
    which tools an agent may call, but nothing in it stops a dealer pointing a
    legitimately-permissioned agent at another dealer's VIN.
    """
    if not await asyncio.to_thread(can_access_vin, principal, req.vin):
        record_principal(principal, "agent.trigger", subject=req.vin, outcome="denied")
        raise HTTPException(404, f"unknown vin {req.vin}")
    record_principal(principal, "agent.trigger", subject=req.vin, trigger=req.trigger)

    job_id = await asyncio.to_thread(
        jobs.create_job, "fleet_run", req.vin, principal.user_id, principal.org_id,
        {"vin": req.vin, "trigger": req.trigger},
    )

    if req.wait:
        # Synchronous path for the demo. Runs the same handler through the same
        # job record, so the audit trail is identical either way.
        await jobs._run_one(job_id)
        response.status_code = 200
        job = await asyncio.to_thread(jobs.get_job, job_id)
        return {"job_id": job_id, "status": job["status"], "result": job.get("result"),
                "error": job.get("error")}

    await jobs.enqueue(job_id)
    return {"job_id": job_id, "status": "queued",
            "poll": f"/api/runs/job/{job_id}"}


@router.get("/runs/job/{job_id}")
async def run_job(job_id: str,
                   principal: Principal = Depends(requires("agent:trigger"))) -> dict:
    job = await asyncio.to_thread(jobs.get_job, job_id)
    # 404 rather than 403 for someone else's job, for the same reason an
    # out-of-scope VIN is a 404: the id should not be probeable.
    if job is None or (not principal.is_unrestricted
                        and job["principal_id"] != principal.user_id):
        raise HTTPException(404, f"unknown job {job_id}")
    return job


@router.get("/runs/jobs")
async def run_jobs(page: Page = Depends(page_params),
                    principal: Principal = Depends(requires("agent:trigger"))) -> dict:
    rows = await asyncio.to_thread(
        jobs.list_jobs,
        None if principal.is_unrestricted else principal.user_id,
        page.limit, page.offset,
    )
    return {"jobs": rows, "page": page.envelope(rows)}



