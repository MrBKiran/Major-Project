"""
Health endpoints.

Split deliberately, because orchestrators ask two different questions:

  /api/health/live   — is this process alive? Never touches a dependency. If it
                       checked Postgres, a database blip would make every replica
                       fail liveness and get killed and restarted, turning a
                       recoverable outage into a crash loop.

  /api/health/ready  — can this process actually serve traffic? Checks the
                       dependencies it cannot work without, and returns 503 when
                       one is down so the load balancer stops sending requests.

  /api/health        — the public summary. Unauthenticated, so it says only whether
                       each dependency is up or down: no latencies, no tool or agent
                       names, no error classes, nothing about how auth is configured.

  /api/health/detail — everything the public summary leaves out, behind `ueba:read`.
"""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, Response
from sqlalchemy import text

from app.auth.deps import requires
from app.auth.keys import signing_key_source
from app.config import settings
from app.db.session import engine

router = APIRouter(prefix="/api/health", tags=["health"])

DEP_TIMEOUT_S = 2.0


def _check_database() -> dict:
    started = time.perf_counter()
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            hypertable = conn.execute(text(
                "SELECT COUNT(*) FROM timescaledb_information.hypertables "
                "WHERE hypertable_name = 'telemetry'"
            )).scalar()
        return {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1),
                "telemetry_hypertable": bool(hypertable)}
    except Exception as exc:  # noqa: BLE001 — the reason is the payload
        return {"ok": False, "error": type(exc).__name__}


def _check_mqtt() -> dict:
    """TCP reachability only — subscribing here would leave a client per probe."""
    import socket

    started = time.perf_counter()
    try:
        with socket.create_connection((settings.mqtt_host, settings.mqtt_port),
                                       timeout=DEP_TIMEOUT_S):
            return {"ok": True,
                    "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except OSError as exc:
        return {"ok": False, "error": type(exc).__name__}


def _check_models() -> dict:
    from pathlib import Path

    artifacts = Path(__file__).resolve().parents[2] / "ml" / "artifacts"
    required = ["m1_health_classifier.joblib", "m2_component_classifier.joblib",
                 "m2_progress_regressor.joblib"]
    missing = [n for n in required if not (artifacts / n).exists()]
    return {"ok": not missing, "missing": missing}


@router.get("/live")
async def live() -> dict:
    """Liveness. Intentionally dependency-free."""
    return {"status": "alive"}


@router.get("/ready")
async def ready(response: Response) -> dict:
    """Readiness. MQTT is not required to serve HTTP — ingest runs as its own
    process — so it is reported but does not gate readiness."""
    db, models = await asyncio.gather(
        asyncio.to_thread(_check_database),
        asyncio.to_thread(_check_models),
    )
    required_ok = db["ok"] and models["ok"]
    if not required_ok:
        response.status_code = 503
    # Up or down only — an orchestrator needs the status code, and a latency, an error class
    # or a list of missing model files tells an unauthenticated caller how to aim.
    return {"status": "ready" if required_ok else "not_ready",
            "checks": {"database": {"ok": db["ok"]}, "ml_artifacts": {"ok": models["ok"]}}}


async def _run_checks() -> list[dict]:
    return await asyncio.gather(
        asyncio.to_thread(_check_database),
        asyncio.to_thread(_check_mqtt),
        asyncio.to_thread(_check_models),
    )


@router.get("")
async def health(response: Response) -> dict:
    db, mqtt, models = await _run_checks()
    ok = db["ok"] and models["ok"]
    if not ok:
        response.status_code = 503
    return {
        "ok": ok,
        # up/down and nothing else: an error class, a latency or a missing-file
        # list tells an unauthenticated caller how to aim.
        "checks": {"database": {"ok": db["ok"]}, "mqtt": {"ok": mqtt["ok"]},
                   "ml_artifacts": {"ok": models["ok"]}},
    }


@router.get("/detail", dependencies=[Depends(requires("ueba:read"))])
async def health_detail(response: Response) -> dict:
    from app.tools.registry import list_tools
    from app.ueba.policy import engine as ueba

    db, mqtt, models = await _run_checks()
    ok = db["ok"] and models["ok"]
    if not ok:
        response.status_code = 503
    return {
        "ok": ok,
        "checks": {"database": db, "mqtt": mqtt, "ml_artifacts": models},
        "tools_registered": len(list_tools()),
        "agents": list(ueba.agents.keys()),
        "ueba": "armed",
        # Whether the signing key was configured or generated — visible to
        # operators here rather than to everyone on the public summary.
        "auth": {"signing_key": signing_key_source(), "environment": settings.environment},
    }
