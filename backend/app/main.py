"""
AutoSaarthi — FastAPI entrypoint.

Run:  cd backend && uvicorn app.main:app --reload --port 8000
Docs: http://localhost:8000/docs

Week 1 surface: the UEBA console + red team endpoints. Those come first on
purpose — the security layer is verified before there is anything to secure.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.api_auth import router as auth_router
from app.api_signin import router as signin_router
from app.api_mfa import router as mfa_router
from app import jobs
from app.api_health import router as health_router
from app.observability import CorrelationMiddleware, configure_logging
from app.security_headers import SecurityHeadersMiddleware
from app.auth import ws as ws_auth
from app.auth.deps import requires
from app.auth.keys import validate_auth_config
from app.auth.mfa import validate_mfa_config
from app.auth.sms import validate_sms_config
from app.push import validate_push_config
from app.api_fleet import router as fleet_router
from app.api_chat import router as chat_router
from app.api_car import router as car_router
from app.api_devices import router as devices_router
from app.config import settings
from app.events import bus
from app.tools import core  # noqa: F401 — importing registers every tool
from app.tools.registry import ToolBlocked, ToolContext, invoke, list_tools
from app.ueba import guard
from app.ueba.audit import audit
from app.ueba.policy import engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    configure_logging()
    # First, before anything with side effects starts: in production an unusable
    # signing key raises here and the app never comes up.
    for warning in [*validate_auth_config(), *validate_sms_config(), *validate_mfa_config(),
                    *validate_push_config()]:
        logging.getLogger("autosaarthi").warning(warning)
    guard.install()                       # bind UEBA into the tool registry
    engine.reload()
    await jobs.start()
    await bus.emit({"type": "system", "msg": "AutoSaarthi online",
                    "tools": len(list_tools()), "agents": len(engine.agents)})
    yield
    await jobs.stop()


app = FastAPI(
    title="AutoSaarthi",
    version="0.1.0",
    description=(
        "Agentic predictive-maintenance platform: a Master Agent orchestrating "
        "Worker Agents over live vehicle telemetry, policed by a UEBA security "
        "layer and a separate multi-tenant RBAC layer (see config/access_policy.yaml "
        "vs config/agent_policy.yaml — they answer different questions and both "
        "apply). Endpoints under `redteam` and `tools` are operational/demo "
        "surfaces: the red-team runner executes real scripted attacks against "
        "the live guard, and the tool catalogue exists for wiring agents. Neither "
        "is meant to be reachable from a production deployment's public edge — "
        "see the note in this file about restricting them at the ingress/gateway "
        "layer, not just behind `redteam:run`/`ueba:read`."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # The refresh cookie (app/auth/refresh.py) only reaches the API at all if the
    # browser is allowed to send credentials cross-origin — the Vite dev server
    # and the API are different origins. Safe only because allow_origins is never
    # "*": the two together are what the CORS spec forbids.
    allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)
app.add_middleware(CorrelationMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(health_router)     # live / ready / detail
app.include_router(auth_router)       # login / me / rbac matrix
app.include_router(signin_router)     # Google, phone code
app.include_router(mfa_router)        # second factor
app.include_router(fleet_router)      # Slides 1-4 read APIs
app.include_router(chat_router)       # live customer chat — turn-by-turn Customer Engagement Agent
app.include_router(car_router)        # car screen: server-decided drive state, booking from the car
app.include_router(devices_router)    # where the mobile app can be reached for push


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Last-resort handler for anything a route didn't catch.

    Two things this buys over letting Starlette's default handler run: the
    failure is logged through our structured JSON logger (so it carries the
    request id and lands in the same stream as everything else, instead of a
    bare traceback on stderr in a different shape), and the response carries
    that same request id back to the caller — "it broke" plus an id support can
    actually search for, instead of a dead end. The response body stays generic
    on purpose; internals belong in the log, not in what a client can read.
    """
    logging.getLogger("autosaarthi.error").exception(
        "unhandled exception on %s %s", request.method, request.url.path,
    )
    from app.observability import current_request_id
    return JSONResponse(
        status_code=500,
        content={"detail": "internal server error", "request_id": current_request_id()},
    )




# ── live event stream (agent trace graph + security console) ───────────────

@app.websocket("/ws/events")
async def ws_events(ws: WebSocket):
    """Live event stream for the security console.

    Carries red-team runs, quarantines and job activity, so it needs the same
    `ueba:read` the console's REST endpoints need. The credential is the first
    message on the socket (see app/auth/ws.py); nothing is sent before it checks
    out, and an open stream re-checks it so a revoked token does not keep
    listening until it expires.
    """
    await ws.accept()
    token = await ws_auth.authenticate(ws, "ueba:read")
    if token is None:
        return

    q = bus.subscribe()
    loop = asyncio.get_running_loop()
    next_check = loop.time() + settings.ws_recheck_s
    try:
        await ws.send_text(json.dumps({"type": "auth_ok"}))
        for ev in bus.replay(100):
            await ws.send_text(json.dumps(ev, default=str))
        while True:
            remaining = next_check - loop.time()
            if remaining <= 0:
                code = ws_auth.revalidate(token, "ueba:read")
                if code is not None:
                    await ws_auth.close_with(ws, code)
                    return
                next_check = loop.time() + settings.ws_recheck_s
                continue
            try:
                ev = await asyncio.wait_for(q.get(), timeout=remaining)
            except asyncio.TimeoutError:
                continue                       # the deadline passed: loop back and recheck
            await ws.send_text(json.dumps(ev, default=str))
    except WebSocketDisconnect:
        pass
    finally:
        bus.unsubscribe(q)


# ── UEBA console (Slide 5) ─────────────────────────────────────────────────

@app.get("/api/ueba/matrix", tags=["ueba"], dependencies=[Depends(requires("ueba:read"))])
async def ueba_matrix():
    """Agent × tool policy grid. Renders as the left panel of the console."""
    return {"matrix": engine.matrix(),
            "tools": [t.schema() for t in list_tools()],
            "scoring": engine.scoring}


@app.get("/api/ueba/events", tags=["ueba"], dependencies=[Depends(requires("ueba:read"))])
async def ueba_events(limit: int = 100):
    return {"events": audit.tail(limit), "stats": audit.stats()}


@app.get("/api/ueba/verify-chain", tags=["ueba"], dependencies=[Depends(requires("ueba:read"))])
async def verify_chain():
    """Tamper-evidence check. Demo this live — it takes one second."""
    return audit.verify()


@app.post("/api/ueba/release/{agent_id}", tags=["ueba"], dependencies=[Depends(requires("ueba:release"))])
async def release_agent(agent_id: str):
    """Human clears a quarantine. Deliberately manual — see human_approval_required."""
    engine.release(agent_id)
    await bus.emit({"type": "ueba_release", "agent_id": agent_id})
    return {"released": agent_id}


# ── Red Team (the button on stage) ─────────────────────────────────────────
#
# DEPLOYMENT NOTE: this endpoint fires real scripted attacks (mass VIN reads,
# a simulated prompt injection, off-hours writes) through the actual tool
# registry and guard — exactly what it's for during a demo, and exactly why it
# should not be reachable from the public internet in a real deployment.
# redteam:run is granted only to platform_admin/security_analyst today, which
# stops an unauthorised PERSON from calling it — it does nothing to stop
# something automated hammering the endpoint before auth even runs (the rate
# limiter helps, but isn't a substitute). In a real deployment this whole
# router should sit behind an internal-only path or be excluded from the
# public ingress entirely, the same way a cloud provider's own chaos-engineering
# tooling is never exposed on the same edge as customer traffic.

class RedTeamRequest(BaseModel):
    attack_id: str


@app.get("/api/redteam/scenarios", tags=["redteam"], dependencies=[Depends(requires("redteam:run"))])
async def redteam_scenarios():
    return {"scenarios": engine.cfg.get("red_team", [])}


@app.post("/api/redteam/run", tags=["redteam"], dependencies=[Depends(requires("redteam:run"))])
async def redteam_run(req: RedTeamRequest):
    """
    Execute a scripted attack against the live system. Nothing is faked:
    the call goes through the real registry and the real guard.
    """
    scenarios = {s["id"]: s for s in engine.cfg.get("red_team", [])}
    sc = scenarios.get(req.attack_id)
    if not sc:
        raise HTTPException(404, f"Unknown scenario {req.attack_id}")

    inj = sc["inject"]
    agent_id = inj["agent_id"]
    run_id = f"redteam-{uuid.uuid4().hex[:6]}"
    results: list[dict] = []

    await bus.emit({"type": "redteam_start", "attack_id": sc["id"],
                    "title": sc["title"], "narrative": sc.get("narrative", "")})

    # ATTACK-3 arrives as an utterance, not a direct tool call
    if inj.get("channel") == "voice":
        calls = [("llm.persuade", {"strategy": "EVIDENCE", "utterance": inj["utterance"]})]
    else:
        n = int(inj.get("repeat", 1))
        vins = ["MH12AB1001", "MH12AB1002", "DL8CA1003", "UP16CD1004", "GJ01EF1005",
                "RJ14GH1006", "TS09IJ1007", "KA03KL1008", "KA05XY1009", "TN09ZZ1010"]
        calls = []
        for i in range(n):
            args = dict(inj.get("args") or {})
            if inj.get("vary") == "vin":
                args["vin"] = vins[i % len(vins)]
            args.setdefault("vin", "MH12AB1001")
            if inj["tool"] == "maintenance.append_record":
                args.setdefault("service_type", "periodic")
            calls.append((inj["tool"], args))

    for tool_name, args in calls:
        ctx = ToolContext(run_id=run_id, agent_id=agent_id, vin=args.get("vin"))
        if (h := inj.get("simulated_hour_ist")) is not None:
            ctx = ctx.model_copy(update={"simulated_hour_ist": h})
        # ATTACK-5 is a drive-state scenario: UEBA rules G6/G7 read drive_state
        # off the context (the console is never trusted to assert it), so the
        # scenario's declared vehicle state has to reach the guard.
        vehicle_state = {k: inj[k] for k in ("drive_state", "speed_kmph") if k in inj}
        if vehicle_state:
            ctx = ctx.model_copy(update=vehicle_state)
        try:
            r = await invoke(agent_id, tool_name, args, ctx)
            results.append({"tool": tool_name, "decision": r.decision, "ok": r.ok})
        except ToolBlocked as e:
            results.append({"tool": tool_name, "decision": "BLOCK",
                            "risk": round(e.risk, 3), "reasons": e.reasons})
            break
        if ms := inj.get("interval_ms"):
            await asyncio.sleep(ms / 1000)

    final = results[-1]["decision"] if results else "NONE"
    expected = (sc.get("expected") or {}).get("decision", "BLOCK")
    outcome = {
        "attack_id": sc["id"],
        "title": sc["title"],
        "caught_by_layers": sc.get("caught_by", []),
        "calls": results,
        "final_decision": final,
        "expected_decision": expected,
        "passed": final == expected or (expected == "FLAG" and final == "BLOCK"),
        "quarantined": engine.scope.is_quarantined(agent_id),
        "recovery": sc.get("expected_recovery"),
    }
    await bus.emit({"type": "redteam_result", **outcome})
    return outcome


@app.post("/api/redteam/reset", tags=["redteam"], dependencies=[Depends(requires("redteam:run"))])
async def redteam_reset():
    from app.ueba import baseline, sequence

    engine.scope.quarantined.clear()
    engine.limiter.reset()
    baseline.reset()
    sequence.reset()
    await bus.emit({"type": "redteam_reset"})
    return {"reset": True}


# ── tool catalogue (useful while wiring agents) ────────────────────────────

@app.get("/api/tools", tags=["tools"], dependencies=[Depends(requires("ueba:read"))])
async def tools(prefix: str | None = None):
    return {"tools": [t.schema() for t in list_tools(prefix)]}
