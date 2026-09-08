"""
Request correlation and structured logging.

Every request gets an id that travels with it: into the log line, into the
response header, and into any agent run it starts. When a service advisor says
"the booking failed at 2pm", the id from their browser is enough to pull the
whole causal chain — HTTP request, access-audit rows, agent tool calls, UEBA
decisions — out of three separate logs that would otherwise only share a
timestamp.

Logs are JSON because they are read by machines first. A human tailing them can
still pipe through `jq`; a human grepping unstructured text at volume cannot
reliably reconstruct a request.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from contextvars import ContextVar

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

# ContextVar rather than a parameter: the id has to reach logging calls deep in
# the stack (db, tools, agents) that have no business taking a request object.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")
principal_var: ContextVar[str] = ContextVar("principal", default="-")

HEADER = "X-Request-ID"

# Endpoints whose latency is uninteresting and whose volume would drown the log.
QUIET_PATHS = {"/api/health", "/api/health/live"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(record.created)),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
            "principal": principal_var.get(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        for key, value in getattr(record, "extra_fields", {}).items():
            payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
    # uvicorn's own access log duplicates the middleware line below, with less
    # context and no request id.
    logging.getLogger("uvicorn.access").disabled = True


class CorrelationMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        # Honour an inbound id so a trace survives a hop from a gateway or the
        # frontend; mint one otherwise.
        rid = request.headers.get(HEADER) or uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        ptoken = principal_var.set("-")
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers[HEADER] = rid
            return response
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000
            if request.url.path not in QUIET_PATHS:
                logging.getLogger("autosaarthi.request").info(
                    "%s %s %s", request.method, request.url.path, status,
                    extra={"extra_fields": {
                        "method": request.method,
                        "path": request.url.path,
                        "status": status,
                        "duration_ms": round(elapsed_ms, 1),
                        "client": request.client.host if request.client else None,
                    }},
                )
            request_id_var.reset(token)
            principal_var.reset(ptoken)


def current_request_id() -> str:
    return request_id_var.get()
