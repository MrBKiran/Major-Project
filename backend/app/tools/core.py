"""
Tool definitions — Week-1 stubs with real signatures.

Every tool the policy matrix references is declared here so UEBA can be tested
end-to-end on day one. Bodies get replaced with real DB/ML/API calls as those
land; the signatures and sensitivity/side-effect metadata do not change.

That ordering matters: the security layer is validated before there is anything
worth attacking.
"""

from __future__ import annotations

import asyncio
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.config import settings
from app.tools.registry import ToolContext, tool


# ── telemetry ───────────────────────────────────────────────────────────────

class ReadWindowArgs(BaseModel):
    vin: str
    minutes: int = Field(default=60, ge=1, le=10080)
    signals: list[str] | None = None


@tool("telemetry.read_window", args_model=ReadWindowArgs,
      description="Read the last N minutes of telemetry for one VIN.",
      sensitivity="internal", side_effect="read",
      requires_vin_scope=True, rate_limit="60/min", tags=["telematics"])
async def read_window(args: ReadWindowArgs, ctx: ToolContext) -> dict:
    from app.db.queries import telemetry_window

    df = await asyncio.to_thread(telemetry_window, args.vin, args.minutes)
    rows = df.to_dict(orient="records") if not df.empty else []
    if args.signals:
        keep = {"ts", "vin", *args.signals}
        rows = [{k: v for k, v in r.items() if k in keep} for r in rows]
    return {"vin": args.vin, "minutes": args.minutes, "rows": rows}


class StreamStatusArgs(BaseModel):
    vin: str | None = None


@tool("telemetry.stream_status", args_model=StreamStatusArgs,
      description="Health of the MQTT telemetry ingest (per VIN or fleet-wide).",
      sensitivity="internal", side_effect="read", tags=["telematics"])
async def stream_status(args: StreamStatusArgs, ctx: ToolContext) -> dict:
    """Whether telemetry is actually arriving, measured from the table.

    Previously hardcoded to "connected, 10 VINs, 41 ms". That is precisely the
    answer you must not fake: the question this tool exists to answer is "is the
    feed alive?", and a stub that always says yes turns a dead ingest into a
    silent one. Staleness is derived from the newest row rather than from broker
    state, because a connected broker with nothing being written is still an
    outage from every consumer's point of view.
    """
    from app.db.session import engine
    from sqlalchemy import text as _sql

    def _query() -> dict:
        with engine.connect() as conn:
            if args.vin:
                row = conn.execute(_sql(
                    "SELECT max(ts) AS newest, count(*) AS rows "
                    "FROM telemetry WHERE vin = :v AND ts >= now() - interval '10 minutes'"),
                    {"v": args.vin}).first()
                vins = 1 if (row and row.rows) else 0
            else:
                row = conn.execute(_sql(
                    "SELECT max(ts) AS newest, count(*) AS rows, "
                    "count(DISTINCT vin) AS vins "
                    "FROM telemetry WHERE ts >= now() - interval '10 minutes'")).first()
                vins = int(row.vins or 0) if row else 0
            lag = conn.execute(_sql(
                "SELECT EXTRACT(EPOCH FROM (now() - :ts)) * 1000"), {"ts": row.newest}
            ).scalar() if row and row.newest else None
            return {"newest": row.newest if row else None,
                    "rows_10min": int(row.rows or 0) if row else 0,
                    "vins_streaming": vins,
                    "lag_ms": round(float(lag)) if lag is not None else None}

    st = await asyncio.to_thread(_query)
    # 90 s: the simulator publishes far faster than this, so anything older means
    # the publisher or the ingest has stopped, not that it is merely between ticks.
    connected = st["lag_ms"] is not None and st["lag_ms"] < 90_000
    return {
        "connected": connected,
        "vins_streaming": st["vins_streaming"],
        "rows_last_10min": st["rows_10min"],
        "lag_ms": st["lag_ms"],
        "newest_ts": st["newest"].isoformat() if st["newest"] else None,
        **({} if connected else
           {"warning": "no telemetry written recently — publisher or ingest is down"}),
    }


# ── maintenance ─────────────────────────────────────────────────────────────

class HistoryArgs(BaseModel):
    vin: str
    limit: int = Field(default=20, ge=1, le=500)


@tool("maintenance.read_history", args_model=HistoryArgs,
      description="Historical service visits and repairs for a VIN.",
      sensitivity="internal", side_effect="read", requires_vin_scope=True)
async def read_history(args: HistoryArgs, ctx: ToolContext) -> dict:
    from app.db.queries import maintenance_history

    records = await asyncio.to_thread(maintenance_history, args.vin, args.limit)
    return {"vin": args.vin, "records": records}


class AggregateArgs(BaseModel):
    group_by: list[str] = Field(default_factory=lambda: ["component", "batch_id"])
    since_days: int = 365
    cohort_size: int | None = None


@tool("maintenance.aggregate", args_model=AggregateArgs,
      description="Aggregate failure counts across the fleet. Never returns PII.",
      sensitivity="internal", side_effect="read")
async def aggregate(args: AggregateArgs, ctx: ToolContext) -> dict:
    from app.db.queries import aggregate_failures

    groups = await asyncio.to_thread(
        aggregate_failures, args.group_by, args.since_days, args.cohort_size or 5,
    )
    return {"groups": groups, "group_by": args.group_by}


class AppendRecordArgs(BaseModel):
    vin: str
    service_type: str
    notes: str = ""
    components_replaced: list[str] = Field(default_factory=list)
    cost_inr: float | None = None


@tool("maintenance.append_record", args_model=AppendRecordArgs,
      description="Append a completed service record to a vehicle's history.",
      sensitivity="internal", side_effect="irreversible",
      requires_vin_scope=True, rate_limit="3/min")
async def append_record(args: AppendRecordArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import append_service_record

    return await asyncio.to_thread(
        append_service_record, args.vin, args.service_type, args.notes,
        args.components_replaced, args.cost_inr,
    )


# ── ml ──────────────────────────────────────────────────────────────────────

class VinWindowArgs(BaseModel):
    vin: str
    minutes: int = 1440


@tool("ml.health_classify", args_model=VinWindowArgs,
      description="M1 — classify vehicle health: Excellent/Good/Needs Service/Critical.",
      sensitivity="internal", side_effect="read", requires_vin_scope=True)
async def health_classify(args: VinWindowArgs, ctx: ToolContext) -> dict:
    from app.db.queries import telemetry_window, vehicle_info
    from app.ml.predict import ModelsNotTrained, classify_health

    df = await asyncio.to_thread(telemetry_window, args.vin, args.minutes)
    info = await asyncio.to_thread(vehicle_info, args.vin)
    odometer = (info or {}).get("odometer", 0)
    try:
        result = await asyncio.to_thread(classify_health, df, odometer)
    except ModelsNotTrained as e:
        return {"vin": args.vin, "health_class": "Unknown", "proba": {}, "error": str(e)}
    return {"vin": args.vin, **result}


@tool("ml.predict_component_failure", args_model=VinWindowArgs,
      description="M2 — per-component failure probability, days-to-failure, P1/P2/P3.",
      sensitivity="internal", side_effect="read",
      requires_vin_scope=True, rate_limit="30/min")
async def predict_failure(args: VinWindowArgs, ctx: ToolContext) -> dict:
    from app.db.queries import telemetry_window, vehicle_info
    from app.ml.predict import ModelsNotTrained, predict_component_failure

    df = await asyncio.to_thread(telemetry_window, args.vin, args.minutes)
    info = await asyncio.to_thread(vehicle_info, args.vin)
    odometer = (info or {}).get("odometer", 0)
    try:
        result = await asyncio.to_thread(predict_component_failure, df, odometer)
    except ModelsNotTrained as e:
        return {"vin": args.vin, "predictions": [], "error": str(e)}
    return {"vin": args.vin, **result}


class WritePredictionsArgs(BaseModel):
    vin: str
    predictions: list[dict[str, Any]] = Field(default_factory=list)
    model_version: str = "m2-v1"


@tool("predictions.write", args_model=WritePredictionsArgs,
      description="Persist component failure predictions for a VIN.",
      sensitivity="internal", side_effect="write",
      requires_vin_scope=True, rate_limit="30/min")
async def write_predictions_tool(args: WritePredictionsArgs, ctx: ToolContext) -> dict:
    from app.db.queries import write_predictions

    # Called even with an empty list: that is how a now-healthy vehicle has its
    # previous predictions cleared.
    return await asyncio.to_thread(
        write_predictions, args.vin, args.predictions, args.model_version,
    )


class ForecastArgs(BaseModel):
    center_id: str | None = None
    horizon_days: int = Field(default=14, ge=1, le=90)


@tool("ml.forecast_demand", args_model=ForecastArgs,
      description="M3 — forecast daily service-centre job volume.",
      sensitivity="internal", side_effect="read", rate_limit="10/min")
async def forecast_demand(args: ForecastArgs, ctx: ToolContext) -> dict:
    from app.ml.forecast import forecast_center, forecast_fleet

    if args.center_id:
        return await asyncio.to_thread(forecast_center, args.center_id, args.horizon_days)
    return await asyncio.to_thread(forecast_fleet, args.horizon_days)


@tool("ml.detect_anomaly", args_model=VinWindowArgs,
      description="M4 — unsupervised anomaly score on the telemetry vector.",
      sensitivity="internal", side_effect="read", requires_vin_scope=True)
async def detect_anomaly(args: VinWindowArgs, ctx: ToolContext) -> dict:
    """Real M4 score, with its own unreliability reported alongside it.

    This previously returned a hardcoded 0.07. That is the one kind of stub
    worth removing first: a caller cannot distinguish a fabricated score from a
    measured one, and this project's claim is that it reports what it measured.
    """
    from app.db.queries import telemetry_window, vehicle_info
    from app.ml.predict import ModelsNotTrained, detect_anomaly as run_m4

    df = await asyncio.to_thread(telemetry_window, args.vin, args.minutes)
    veh = await asyncio.to_thread(vehicle_info, args.vin)
    try:
        result = await asyncio.to_thread(run_m4, df, (veh or {}).get("odometer") or 0.0)
    except ModelsNotTrained as e:
        return {"vin": args.vin, "anomaly_score": None, "error": str(e)}
    return {"vin": args.vin, "minutes": args.minutes, **result}


# ── diagnostics knowledge ───────────────────────────────────────────────────

class DtcArgs(BaseModel):
    code: str


@tool("dtc.lookup", args_model=DtcArgs,
      description="Look up a diagnostic trouble code: component, severity, causes.",
      sensitivity="public", side_effect="read")
async def dtc_lookup(args: DtcArgs, ctx: ToolContext) -> dict:
    from app.db.queries import dtc_lookup as query_dtc

    result = await asyncio.to_thread(query_dtc, args.code)
    return result or {"code": args.code, "error": "unknown code"}


class SymptomArgs(BaseModel):
    query: str
    k: int = 5


@tool("kb.search_symptoms", args_model=SymptomArgs,
      description="Semantic search over the service knowledge base.",
      sensitivity="public", side_effect="read")
async def kb_search(args: SymptomArgs, ctx: ToolContext) -> dict:
    return {"query": args.query, "hits": [], "_stub": True}


# ── crm ─────────────────────────────────────────────────────────────────────

class CustomerArgs(BaseModel):
    customer_id: str | None = None
    vin: str | None = None


@tool("crm.get_customer", args_model=CustomerArgs,
      description="Fetch owner profile: name, phone, language, preferences.",
      sensitivity="pii", side_effect="read")
async def get_customer(args: CustomerArgs, ctx: ToolContext) -> dict:
    from app.db.queries import customer_for_vin

    if not args.vin:
        return {"customer_id": args.customer_id, "error": "vin required"}
    result = await asyncio.to_thread(customer_for_vin, args.vin)
    return result or {"vin": args.vin, "error": "no customer on file"}


@tool("crm.get_consent", args_model=CustomerArgs,
      description="Check voice/notification consent flags before contacting an owner.",
      sensitivity="pii", side_effect="read")
async def get_consent(args: CustomerArgs, ctx: ToolContext) -> dict:
    from app.db.queries import customer_for_vin

    if not args.vin:
        return {"voice": False, "push": False, "error": "vin required"}
    cust = await asyncio.to_thread(customer_for_vin, args.vin)
    if not cust:
        return {"voice": False, "push": False, "error": "no customer on file"}
    return {"voice": bool(cust["consent_voice"]), "push": bool(cust["consent_push"])}


# ── voice + notifications ───────────────────────────────────────────────────

class SpeakArgs(BaseModel):
    text: str
    language: Literal["english", "hindi", "hinglish"] = "english"
    voice: str = "en_IN-female"


@tool("voice.speak", args_model=SpeakArgs,
      description="Synthesise speech and stream it to the caller.",
      sensitivity="pii", side_effect="external", rate_limit="40/min")
async def speak(args: SpeakArgs, ctx: ToolContext) -> dict:
    return {"spoken": args.text[:80], "audio_url": None, "_stub": True}


class ListenArgs(BaseModel):
    timeout_s: float = 8.0
    utterance: str | None = None   # injected transcript in DEMO_MODE / red team
    turn: int = 0                  # which scripted reply to use in DEMO_MODE


@tool("voice.listen", args_model=ListenArgs,
      description="Capture and transcribe the owner's reply.",
      sensitivity="pii", side_effect="read")
async def listen(args: ListenArgs, ctx: ToolContext) -> dict:
    if args.utterance:
        return {"transcript": args.utterance}
    if settings.demo_mode and ctx.vin:
        from app.llm.dialogue import scripted_reply
        return {"transcript": scripted_reply(ctx.vin, args.turn), "source": "demo_fixture"}
    # No live STT wired yet (Week 2) and no fixture available — silence, not a crash.
    return {"transcript": "", "error": "no live STT pipeline and DEMO_MODE is off"}


class PersuadeArgs(BaseModel):
    strategy: str
    diagnosis: dict[str, Any] = Field(default_factory=dict)
    utterance: str | None = None
    reading: str | None = None      # actual sensor value quoted as evidence
    slot_day: str | None = None
    slot_time: str | None = None
    center_name: str | None = None


@tool("llm.persuade", args_model=PersuadeArgs,
      description="Generate the next persuasive turn using a named strategy.",
      sensitivity="pii", side_effect="read")
async def persuade(args: PersuadeArgs, ctx: ToolContext) -> dict:
    from app.llm.persuasion import next_turn

    if not ctx.vin:
        return {"strategy": args.strategy, "text": "", "error": "no vin in context"}
    # `utterance`, when present, is the owner's last reply — passed through so
    # a real LLM call has objection context; DEMO_MODE fixtures ignore it.
    extra = {
        "customer_last_reply": args.utterance,
        "reading": args.reading,
        "slot_day": args.slot_day,
        "slot_time": args.slot_time,
        "center_name": args.center_name,
    }
    extra = {k: v for k, v in extra.items() if v}
    return await next_turn(args.strategy, ctx.vin, args.diagnosis, extra or None)


class AnswerArgs(BaseModel):
    # Named `utterance` to match llm.persuade, and because UEBA Layer C only
    # scans a fixed set of free-text keys for prompt injection — a question
    # arriving under a key that set doesn't know about would skip the check.
    utterance: str
    facts: list[str] = Field(default_factory=list)
    # Prior turns, oldest-first: [{"role": "user"|"agent", "text": ...}].
    history: list[dict[str, Any]] = Field(default_factory=list)


@tool("llm.answer", args_model=AnswerArgs,
      description="Answer an owner's question using only pre-gathered facts.",
      sensitivity="pii", side_effect="read")
async def answer(args: AnswerArgs, ctx: ToolContext) -> dict:
    """Speak an answer the calling agent already has the facts for.

    Deliberately takes `facts` as an argument instead of fetching anything:
    agent_policy.yaml denies telemetry and ML to the agent allowed to talk to
    customers, so the tool that talks must not be a side door into the data it
    is not cleared to read. Whoever calls this has to have obtained the facts
    through their own entitlements first.
    """
    from app.llm.answering import answer_question

    if not (args.utterance or "").strip():
        return {"strategy": "ANSWER", "text": "", "error": "empty question"}
    return await answer_question(args.utterance, args.facts, args.history)


class PushArgs(BaseModel):
    customer_id: str | None = None
    title: str
    body: str
    deeplink: str | None = None


@tool("notify.push", args_model=PushArgs,
      description="Send a mobile app push notification (secondary channel).",
      sensitivity="pii", side_effect="external", rate_limit="5/min")
async def push(args: PushArgs, ctx: ToolContext) -> dict:
    from app import push as delivery

    data = {"deeplink": args.deeplink} if args.deeplink else {}
    return await asyncio.to_thread(delivery.notify_customer, args.customer_id,
                                   args.title, args.body, data)


class PlantNotifyArgs(BaseModel):
    plant: str
    capa_id: str
    summary: str


@tool("notify.plant", args_model=PlantNotifyArgs,
      description="Send a CAPA insight to the manufacturing team. Human-approved.",
      sensitivity="internal", side_effect="irreversible", rate_limit="2/min")
async def notify_plant(args: PlantNotifyArgs, ctx: ToolContext) -> dict:
    return {"delivered": True, "capa_id": args.capa_id, "_stub": True}


# ── scheduling ──────────────────────────────────────────────────────────────

class SlotsArgs(BaseModel):
    center_id: str | None = None
    city: str | None = None
    from_date: str | None = None
    days: int = 7
    skill: str | None = None


@tool("scheduler.get_slots", args_model=SlotsArgs,
      description="List open appointment slots across service centres.",
      sensitivity="internal", side_effect="read")
async def get_slots(args: SlotsArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import get_open_slots

    slots = await asyncio.to_thread(
        get_open_slots, args.center_id, args.city, args.from_date, args.days, args.skill,
    )
    return {"slots": slots}


class HoldArgs(BaseModel):
    center_id: str
    slot_start: str
    vin: str


@tool("scheduler.hold", args_model=HoldArgs,
      description="Place a temporary hold on a slot while the owner decides.",
      sensitivity="internal", side_effect="write", requires_vin_scope=True)
async def hold(args: HoldArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import hold_slot

    return await asyncio.to_thread(hold_slot, args.center_id, args.slot_start, args.vin)


class ConfirmArgs(BaseModel):
    center_id: str
    slot_start: str
    vin: str
    customer_id: str | None = None


@tool("scheduler.confirm", args_model=ConfirmArgs,
      description="Confirm and book an appointment.",
      sensitivity="pii", side_effect="irreversible",
      requires_vin_scope=True, rate_limit="5/min")
async def confirm(args: ConfirmArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import confirm_appointment

    return await asyncio.to_thread(
        confirm_appointment, args.vin, args.center_id, args.slot_start, ctx.agent_id, ctx.run_id,
    )


class CancelArgs(BaseModel):
    appointment_id: str
    reason: str = ""


@tool("scheduler.cancel", args_model=CancelArgs,
      description="Cancel a booked appointment.",
      sensitivity="pii", side_effect="irreversible", rate_limit="3/min")
async def cancel(args: CancelArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import cancel_appointment

    return await asyncio.to_thread(cancel_appointment, args.appointment_id, args.reason)


class EtaArgs(BaseModel):
    from_city: str
    center_id: str


@tool("maps.eta", args_model=EtaArgs,
      description="Estimated travel time from the owner to a service centre.",
      sensitivity="public", side_effect="read")
async def eta(args: EtaArgs, ctx: ToolContext) -> dict:
    """Travel time from the owner's city to a centre, from real coordinates.

    Great-circle distance with a road-winding factor and an urban average speed
    — not a routing API, and it does not pretend to be one: `method` says how
    the number was produced so a caller can see it is an estimate. Same-city is
    the common case and is answered from the centre's own coordinates rather
    than a fixed guess, which is what the previous hardcoded 18 minutes was.
    """
    from math import asin, cos, radians, sin, sqrt
    from app.db.queries import service_center

    centre = await asyncio.to_thread(service_center, args.center_id)
    if not centre:
        return {"minutes": None, "error": f"unknown centre {args.center_id}"}

    # City centroids for the cities this fleet operates in. A owner-side GPS fix
    # would replace this; the centre end is already exact.
    CITY = {
        "pune": (18.5204, 73.8567), "mumbai": (19.0760, 72.8777),
        "delhi": (28.6139, 77.2090), "bengaluru": (12.9716, 77.5946),
        "chennai": (13.0827, 80.2707), "hyderabad": (17.3850, 78.4867),
        "jaipur": (26.9124, 75.7873), "meerut": (28.9845, 77.7064),
        "rajkot": (22.3039, 70.8022), "nashik": (19.9975, 73.7898),
    }
    origin = CITY.get((args.from_city or "").strip().lower())
    clat, clng = centre.get("lat"), centre.get("lng")
    if origin is None or clat is None or clng is None:
        return {"minutes": None, "center_id": args.center_id,
                "error": "no coordinates for this city/centre pair"}

    lat1, lng1 = origin
    dlat, dlng = radians(clat - lat1), radians(clng - lng1)
    a = sin(dlat/2)**2 + cos(radians(lat1)) * cos(radians(clat)) * sin(dlng/2)**2
    straight_km = 2 * 6371.0 * asin(sqrt(a))
    road_km = straight_km * 1.35          # typical Indian urban road/straight ratio
    same_city = (centre.get("city") or "").strip().lower() == (args.from_city or "").strip().lower()
    speed_kmph = 22.0 if same_city else 45.0
    minutes = max(8, round(road_km / speed_kmph * 60))
    return {
        "minutes": minutes,
        "distance_km": round(road_km, 1),
        "center_id": args.center_id,
        "center_city": centre.get("city"),
        "same_city": same_city,
        "method": f"great-circle x1.35 road factor at {speed_kmph:.0f} km/h",
    }


# ── feedback ────────────────────────────────────────────────────────────────

# NOTE: service completion is deliberately NOT a registered tool. Closing a
# workshop job is an action of the dealer management system, not of any agent,
# and no agent in config/agent_policy.yaml is granted it. It is exposed as a
# system event instead (app.db.scheduling.complete_service), which the demo
# drives directly — registering a tool nothing is allowed to call would just be
# dead policy surface.


class SurveyArgs(BaseModel):
    appointment_id: str
    csat: int = Field(ge=1, le=5)
    nps: int | None = Field(default=None, ge=0, le=10)
    verbatim: str = ""


@tool("survey.record", args_model=SurveyArgs,
      description="Record post-service customer satisfaction.",
      sensitivity="pii", side_effect="write")
async def survey_record(args: SurveyArgs, ctx: ToolContext) -> dict:
    from app.db.scheduling import record_feedback

    return await asyncio.to_thread(
        record_feedback, args.appointment_id, args.csat, args.nps, args.verbatim,
    )


# ── manufacturing quality ───────────────────────────────────────────────────

class CapaSearchArgs(BaseModel):
    query: str
    k: int = Field(default=5, ge=1, le=25)


@tool("capa.search", args_model=CapaSearchArgs,
      description="Semantic search over historical CAPA/RCA records.",
      sensitivity="internal", side_effect="read")
async def capa_search(args: CapaSearchArgs, ctx: ToolContext) -> dict:
    from app.rca.corpus import search

    hits = await asyncio.to_thread(search, args.query, args.k)
    return {"query": args.query, "hits": hits}


class ClusterArgs(BaseModel):
    component: str | None = None
    since_days: int = 365
    min_lift: float = 2.0
    cohort_size: int | None = None


@tool("defect.cluster", args_model=ClusterArgs,
      description="Find statistically significant defect clusters by batch/plant/model.",
      sensitivity="internal", side_effect="read")
async def defect_cluster(args: ClusterArgs, ctx: ToolContext) -> dict:
    from app.rca.cluster import find_clusters
    from app.ueba.policy import engine

    # k-anonymity floor from the agent's own data_scope (min_cohort_size) —
    # no cluster may be reported over a cohort smaller than the policy allows.
    scope = (engine.agent_cfg(ctx.agent_id).get("data_scope") or {})
    min_cohort = args.cohort_size or int(scope.get("min_cohort_size", 5))

    clusters = await asyncio.to_thread(
        find_clusters, args.component, args.min_lift, min_cohort,
    )
    return {"clusters": clusters, "min_cohort_size": min_cohort}


class CapaDraftArgs(BaseModel):
    cluster_key: str
    evidence: dict[str, Any] = Field(default_factory=dict)
    cited_capa_ids: list[str] = Field(default_factory=list)


@tool("capa.draft", args_model=CapaDraftArgs,
      description="Draft a CAPA ticket with a grounded 5-Why chain and citations.",
      sensitivity="internal", side_effect="write", rate_limit="5/min")
async def capa_draft(args: CapaDraftArgs, ctx: ToolContext) -> dict:
    from app.rca.draft import draft_capa

    if not args.evidence:
        return {"error": "capa.draft requires the cluster dict from defect.cluster as `evidence`"}
    return await asyncio.to_thread(draft_capa, args.evidence)


class RenderPdfArgs(BaseModel):
    kind: Literal["capa", "run_summary", "service_report"]
    payload: dict[str, Any] = Field(default_factory=dict)


@tool("report.render_pdf", args_model=RenderPdfArgs,
      description="Render a report to PDF for download.",
      sensitivity="internal", side_effect="write")
async def render_pdf(args: RenderPdfArgs, ctx: ToolContext) -> dict:
    """Write a real PDF from the payload the caller assembled.

    The renderer reads nothing itself — see app/reports.py. Whoever calls this
    must already hold the data through their own entitlements, so the report
    cannot become a second, unpoliced route to rows an agent may not read.
    """
    from app.reports import render

    try:
        return await asyncio.to_thread(render, args.kind, args.payload, ctx.run_id)
    except ValueError as e:
        return {"path": None, "error": str(e)}


# ── orchestration / governance ──────────────────────────────────────────────

class WritePlanArgs(BaseModel):
    steps: list[str]
    rationale: str = ""


@tool("runs.write_plan", args_model=WritePlanArgs,
      description="Master Agent declares its plan for this run. UEBA enforces against it.",
      sensitivity="internal", side_effect="write", rate_limit="20/min")
async def write_plan(args: WritePlanArgs, ctx: ToolContext) -> dict:
    from app.ueba.policy import engine
    engine.scope.set_plan(ctx.run_id, args.steps)
    return {"plan": args.steps, "run_id": ctx.run_id}


class CloseRunArgs(BaseModel):
    outcome: str
    summary: str = ""


@tool("runs.close", args_model=CloseRunArgs,
      description="Close the run and emit a summary.",
      sensitivity="internal", side_effect="write")
async def close_run(args: CloseRunArgs, ctx: ToolContext) -> dict:
    return {"closed": True, "outcome": args.outcome}


class UebaReadArgs(BaseModel):
    limit: int = 50


@tool("ueba.read_events", args_model=UebaReadArgs,
      description="Read recent UEBA decisions (Master Agent situational awareness).",
      sensitivity="internal", side_effect="read")
async def ueba_read(args: UebaReadArgs, ctx: ToolContext) -> dict:
    from app.ueba.audit import audit
    return {"events": audit.tail(args.limit)}


# ── in-car console (IVI) ────────────────────────────────────────────────────
# The console is a thin client: it renders what these tools tell it to and
# nothing more. Every tool that would demand the driver's hands or eyes is
# gated by UEBA rules G6/G7 against the server-derived drive_state.

class ConsoleSpeakArgs(BaseModel):
    vin: str
    text: str
    language: Literal["english", "hindi", "hinglish"] = "english"
    strategy: str | None = None       # shown as a chip in the demo UI


@tool("console.speak", args_model=ConsoleSpeakArgs,
      description="Speak to the driver through the car's speakers and caption it on screen.",
      sensitivity="pii", side_effect="external",
      requires_vin_scope=True, rate_limit="40/min", tags=["console"])
async def console_speak(args: ConsoleSpeakArgs, ctx: ToolContext) -> dict:
    return {"spoken": args.text[:80], "strategy": args.strategy, "_stub": True}


class ConsoleAlertArgs(BaseModel):
    vin: str
    severity: Literal["P1", "P2", "P3"]
    component: str
    headline: str
    days_to_failure: int | None = None
    elements: int = 1                 # G7 caps this at 1 while in motion


@tool("console.show_alert", args_model=ConsoleAlertArgs,
      description="Render a predicted-failure alert card. Voice-safe: one element while driving.",
      sensitivity="internal", side_effect="write",
      requires_vin_scope=True, tags=["console"])
async def console_show_alert(args: ConsoleAlertArgs, ctx: ToolContext) -> dict:
    return {"rendered": True, "severity": args.severity, "_stub": True}


class ConsoleSlotsArgs(BaseModel):
    vin: str
    slots: list[dict[str, Any]] = Field(default_factory=list)


@tool("console.show_slots", args_model=ConsoleSlotsArgs,
      description="Render up to 3 tappable appointment slots. BLOCKED unless PARKED (UEBA G6).",
      sensitivity="internal", side_effect="write",
      requires_vin_scope=True, tags=["console", "requires_parked"])
async def console_show_slots(args: ConsoleSlotsArgs, ctx: ToolContext) -> dict:
    return {"rendered": len(args.slots), "_stub": True}


class ConsoleTouchArgs(BaseModel):
    vin: str
    prompt: str
    options: list[str] = Field(default_factory=list)


@tool("console.request_touch", args_model=ConsoleTouchArgs,
      description="Ask the driver for a tap. BLOCKED unless PARKED (UEBA G6).",
      sensitivity="internal", side_effect="write",
      requires_vin_scope=True, tags=["console", "requires_parked"])
async def console_request_touch(args: ConsoleTouchArgs, ctx: ToolContext) -> dict:
    return {"awaiting": True, "_stub": True}


class DriveStateArgs(BaseModel):
    vin: str


@tool("console.get_drive_state", args_model=DriveStateArgs,
      description="Server-derived vehicle state: IGNITION_OFF | PARKED | STOPPED_BRIEF | DRIVING.",
      sensitivity="internal", side_effect="read",
      requires_vin_scope=True, tags=["console"])
async def console_drive_state(args: DriveStateArgs, ctx: ToolContext) -> dict:
    return {"vin": args.vin, "drive_state": ctx.drive_state or "PARKED",
            "speed_kmph": ctx.speed_kmph or 0.0, "_stub": True}
