"""
Background job runner for agent runs.

A Master-graph run does model inference, several DB round trips and (in Week 2)
a voice call. Holding an HTTP request open for that has three problems at any
real scale: it pins a worker for the whole duration, it puts the run at the
mercy of the client's timeout, and a disconnect mid-way leaves a half-finished
run nobody is tracking.

So `POST /api/runs/trigger` now returns 202 with a job id immediately, and the
run proceeds independently. Callers poll `GET /api/runs/job/{id}` or watch the
existing `/ws/events` stream.

Scope: this is an in-process asyncio runner with a bounded worker pool and a
Postgres-backed job table. It survives a client disconnect, not a process
restart — jobs still RUNNING at startup are marked `interrupted` rather than
silently appearing to hang forever. Moving to Celery/RQ/Arq means replacing
`_worker` and leaving the API and the job table as they are; that seam is the
reason this is a module rather than a `BackgroundTasks` call in the route.
"""

from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import uuid
from typing import Any, Awaitable, Callable

from sqlalchemy import text

from app.db.session import engine
from app.observability import current_request_id

logger = logging.getLogger("autosaarthi.jobs")

# Bounded on purpose. Unbounded concurrency here would let a burst of triggers
# open more DB connections than the pool has and stall the whole API.
MAX_CONCURRENT_JOBS = 4
JOB_TIMEOUT_S = 300

_queue: asyncio.Queue | None = None
_workers: list[asyncio.Task] = []


# ── persistence ────────────────────────────────────────────────────────────

def _write(job_id: str, **fields) -> None:
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    with engine.begin() as conn:
        conn.execute(text(f"UPDATE agent_jobs SET {sets} WHERE id = :id"),
                      {"id": job_id, **fields})


def create_job(kind: str, vin: str | None, principal_id: str, org_id: str,
                params: dict) -> str:
    job_id = f"job-{uuid.uuid4().hex[:12]}"
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO agent_jobs
                (id, kind, vin, principal_id, org_id, status, params,
                 request_id, created_at)
            VALUES (:id, :kind, :vin, :pid, :org, 'queued', :params, :rid, :now)
        """), {"id": job_id, "kind": kind, "vin": vin, "pid": principal_id,
                "org": org_id, "params": json.dumps(params),
                "rid": current_request_id(),
                "now": dt.datetime.now(dt.timezone.utc)})
    return job_id


def get_job(job_id: str) -> dict | None:
    with engine.connect() as conn:
        row = conn.execute(text("SELECT * FROM agent_jobs WHERE id = :id"),
                            {"id": job_id}).first()
    return dict(row._mapping) if row else None


def list_jobs(principal_id: str | None, limit: int, offset: int) -> list[dict]:
    clause = "WHERE principal_id = :pid" if principal_id else ""
    params: dict[str, Any] = {"limit": limit, "offset": offset}
    if principal_id:
        params["pid"] = principal_id
    with engine.connect() as conn:
        rows = conn.execute(text(
            f"SELECT id, kind, vin, status, created_at, started_at, finished_at, error "
            f"FROM agent_jobs {clause} ORDER BY created_at DESC, id "
            f"LIMIT :limit OFFSET :offset"), params).all()
    return [dict(r._mapping) for r in rows]


# ── execution ──────────────────────────────────────────────────────────────

Handler = Callable[[dict], Awaitable[dict]]
_handlers: dict[str, Handler] = {}


def register(kind: str):
    def deco(fn: Handler) -> Handler:
        _handlers[kind] = fn
        return fn
    return deco


async def _run_one(job_id: str) -> None:
    job = get_job(job_id)
    if job is None:
        return
    handler = _handlers.get(job["kind"])
    if handler is None:
        _write(job_id, status="failed", error=f"no handler for kind {job['kind']}",
                finished_at=dt.datetime.now(dt.timezone.utc))
        return

    _write(job_id, status="running", started_at=dt.datetime.now(dt.timezone.utc))
    params = job["params"] if isinstance(job["params"], dict) else json.loads(job["params"] or "{}")
    try:
        result = await asyncio.wait_for(handler(params), timeout=JOB_TIMEOUT_S)
        _write(job_id, status="succeeded", result=json.dumps(result, default=str),
                finished_at=dt.datetime.now(dt.timezone.utc))
    except asyncio.TimeoutError:
        _write(job_id, status="failed", error=f"timed out after {JOB_TIMEOUT_S}s",
                finished_at=dt.datetime.now(dt.timezone.utc))
        logger.warning("job %s timed out", job_id)
    except Exception as exc:  # noqa: BLE001 — a failed job must not kill the worker
        _write(job_id, status="failed", error=f"{type(exc).__name__}: {exc}",
                finished_at=dt.datetime.now(dt.timezone.utc))
        logger.exception("job %s failed", job_id)


async def _worker(n: int) -> None:
    assert _queue is not None
    while True:
        job_id = await _queue.get()
        try:
            await _run_one(job_id)
        finally:
            _queue.task_done()


async def enqueue(job_id: str) -> None:
    assert _queue is not None, "job runner not started"
    await _queue.put(job_id)


async def start(concurrency: int = MAX_CONCURRENT_JOBS) -> None:
    global _queue
    _queue = asyncio.Queue()

    # Anything left RUNNING belongs to a process that is gone. Marking it
    # explicitly is the difference between "this failed, retry it" and a job
    # that appears to be working forever.
    with engine.begin() as conn:
        orphaned = conn.execute(text(
            "UPDATE agent_jobs SET status = 'interrupted', "
            "error = 'process restarted while running', finished_at = :now "
            "WHERE status IN ('running', 'queued') RETURNING id"
        ), {"now": dt.datetime.now(dt.timezone.utc)}).all()
    if orphaned:
        logger.warning("marked %d job(s) interrupted after restart", len(orphaned))

    _workers.extend(asyncio.create_task(_worker(i)) for i in range(concurrency))
    logger.info("job runner started with %d workers", concurrency)


async def stop() -> None:
    for task in _workers:
        task.cancel()
    _workers.clear()


# ── handlers ───────────────────────────────────────────────────────────────

@register("fleet_run")
async def _handle_fleet_run(params: dict) -> dict:
    from app.graph.master import run_fleet_graph

    state = await run_fleet_graph(params["vin"], params.get("trigger", "manual"))
    return {
        "run_id": state.get("run_id"), "vin": state.get("vin"),
        "health": state.get("health"), "diagnosis": state.get("diagnosis"),
        "conversation": state.get("conversation"), "booking": state.get("booking"),
        "outcome": state.get("service_status"), "completed": state.get("completed"),
        "halted": state.get("halted"), "halt_reason": state.get("halt_reason"),
    }
