"""
AutoSaarthi — Tool Registry
Commit #2. Everything hangs off this.

Every capability a Worker Agent has is a registered tool. The registry is the
single choke point that makes three things possible at once:

  1. LangGraph agents get typed, validated tool schemas.
  2. UEBA gets a stable (agent_id, tool_name) key to enforce policy on.
  3. The UI gets a live event for every capability invocation.

Design rule: an agent NEVER imports another module's function directly.
It calls `await invoke(agent_id, tool_name, args, ctx)`. No exceptions.
That is what makes the security layer non-bypassable.
"""

from __future__ import annotations

import asyncio
import functools
import inspect
import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Literal

from pydantic import BaseModel, ValidationError

# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------

Sensitivity = Literal["public", "internal", "pii", "restricted"]
SideEffect = Literal["read", "write", "external", "irreversible"]


class ToolContext(BaseModel):
    """Ambient context every tool call carries. UEBA reads this."""

    run_id: str
    agent_id: str
    vin: str | None = None
    customer_id: str | None = None
    trace_id: str = ""
    demo_mode: bool = False
    # in-car console state. Server-derived only — see PROJECT_PLAN §2A.3.
    # The console client never sets this; UEBA G6/G7 read it.
    drive_state: Literal["IGNITION_OFF", "PARKED", "STOPPED_BRIEF", "DRIVING"] | None = None
    speed_kmph: float | None = None

    model_config = {"extra": "allow"}


class ToolResult(BaseModel):
    ok: bool
    data: Any = None
    error: str | None = None
    latency_ms: float = 0.0
    tool: str = ""
    agent_id: str = ""
    decision: str = "ALLOW"  # ALLOW | FLAG | BLOCK — stamped by the guard
                             # INVALID = rejected by schema validation, guard never ran


@dataclass
class ToolSpec:
    name: str
    fn: Callable[..., Awaitable[Any]]
    args_model: type[BaseModel]
    description: str
    sensitivity: Sensitivity
    side_effect: SideEffect
    # UEBA hints — used by policy.py and scorer.py
    default_rate_limit: str | None = None      # e.g. "10/min"
    requires_vin_scope: bool = False           # arg VIN must match ctx.vin
    tags: list[str] = field(default_factory=list)

    def schema(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.args_model.model_json_schema(),
            "sensitivity": self.sensitivity,
            "side_effect": self.side_effect,
        }


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

TOOL_REGISTRY: dict[str, ToolSpec] = {}


def tool(
    name: str,
    *,
    args_model: type[BaseModel],
    description: str,
    sensitivity: Sensitivity = "internal",
    side_effect: SideEffect = "read",
    rate_limit: str | None = None,
    requires_vin_scope: bool = False,
    tags: list[str] | None = None,
):
    """
    Register a coroutine as an agent-callable tool.

        @tool("telemetry.read_window",
              args_model=ReadWindowArgs,
              description="Read the last N telemetry rows for a VIN",
              sensitivity="internal",
              requires_vin_scope=True)
        async def read_window(args: ReadWindowArgs, ctx: ToolContext) -> list[dict]:
            ...
    """

    def decorator(fn: Callable[..., Awaitable[Any]]):
        if name in TOOL_REGISTRY:
            raise RuntimeError(f"Tool '{name}' already registered")
        if not inspect.iscoroutinefunction(fn):
            raise TypeError(f"Tool '{name}' must be async")

        TOOL_REGISTRY[name] = ToolSpec(
            name=name,
            fn=fn,
            args_model=args_model,
            description=description,
            sensitivity=sensitivity,
            side_effect=side_effect,
            default_rate_limit=rate_limit,
            requires_vin_scope=requires_vin_scope,
            tags=tags or [],
        )

        @functools.wraps(fn)
        async def wrapper(*a, **kw):
            return await fn(*a, **kw)

        return wrapper

    return decorator


def get(name: str) -> ToolSpec:
    if name not in TOOL_REGISTRY:
        raise KeyError(f"Unknown tool '{name}'")
    return TOOL_REGISTRY[name]


def list_tools(prefix: str | None = None) -> list[ToolSpec]:
    specs = list(TOOL_REGISTRY.values())
    if prefix:
        specs = [s for s in specs if s.name.startswith(prefix)]
    return sorted(specs, key=lambda s: s.name)


def schemas_for(tool_names: list[str]) -> list[dict]:
    """LLM-facing tool schemas for the subset an agent is allowed to call."""
    return [get(n).schema() for n in tool_names if n in TOOL_REGISTRY]


# ---------------------------------------------------------------------------
# Invocation — the single choke point
# ---------------------------------------------------------------------------

# Injected at startup by app.main to avoid a circular import.
# Signature: async (spec, args, ctx) -> (decision:str, risk:float, reasons:list)
_ueba_guard: Callable[..., Awaitable[tuple[str, float, list]]] | None = None
_event_sink: Callable[[dict], Any] | None = None


def bind_guard(guard_fn) -> None:
    global _ueba_guard
    _ueba_guard = guard_fn


def bind_event_sink(sink_fn) -> None:
    global _event_sink
    _event_sink = sink_fn


async def _emit(payload: dict) -> None:
    if _event_sink is None:
        return
    res = _event_sink(payload)
    if inspect.isawaitable(res):
        await res


class ToolBlocked(Exception):
    def __init__(self, tool: str, agent_id: str, risk: float, reasons: list):
        self.tool, self.agent_id, self.risk, self.reasons = tool, agent_id, risk, reasons
        super().__init__(f"UEBA BLOCKED {agent_id} → {tool} (risk={risk:.2f})")


async def invoke(
    agent_id: str,
    tool_name: str,
    args: dict | BaseModel,
    ctx: ToolContext,
    *,
    timeout_s: float = 30.0,
) -> ToolResult:
    """
    The ONLY way an agent executes a capability.

    Order of operations is deliberate and must not be reordered:
        resolve → validate → UEBA guard → execute → audit → emit
    Validating before the guard means UEBA scores real, typed arguments.
    """
    t0 = time.perf_counter()
    call_id = str(uuid.uuid4())[:8]

    # 1. resolve
    try:
        spec = get(tool_name)
    except KeyError as e:
        return ToolResult(ok=False, error=str(e), tool=tool_name, agent_id=agent_id)

    # 2. validate
    try:
        parsed = args if isinstance(args, spec.args_model) else spec.args_model(**dict(args))
    except ValidationError as e:
        # Not "ALLOW": the guard never ran, so claiming it allowed this would
        # put a decision in the audit trail that no layer actually made. The
        # call is rejected here and never executes.
        return ToolResult(
            ok=False,
            error=f"Invalid args for {tool_name}: {e.errors()}",
            tool=tool_name,
            agent_id=agent_id,
            decision="INVALID",
        )

    ctx = ctx.model_copy(update={"agent_id": agent_id, "trace_id": call_id})

    # 3. UEBA guard — non-bypassable
    decision, risk, reasons = "ALLOW", 0.0, []
    if _ueba_guard is not None:
        decision, risk, reasons = await _ueba_guard(spec, parsed, ctx)

    await _emit(
        {
            "type": "tool_call",
            "call_id": call_id,
            "run_id": ctx.run_id,
            "agent_id": agent_id,
            "tool": tool_name,
            "sensitivity": spec.sensitivity,
            "side_effect": spec.side_effect,
            "decision": decision,
            "risk": round(risk, 3),
            "reasons": reasons,
            "args_preview": _redact(parsed.model_dump()),
            "ts": time.time(),
        }
    )

    if decision == "BLOCK":
        raise ToolBlocked(tool_name, agent_id, risk, reasons)

    # 4. execute
    try:
        data = await asyncio.wait_for(spec.fn(parsed, ctx), timeout=timeout_s)
        ok, err = True, None
    except asyncio.TimeoutError:
        data, ok, err = None, False, f"{tool_name} timed out after {timeout_s}s"
    except Exception as e:  # noqa: BLE001 — tools must never crash the graph
        data, ok, err = None, False, f"{type(e).__name__}: {e}"

    latency = (time.perf_counter() - t0) * 1000

    await _emit(
        {
            "type": "tool_result",
            "call_id": call_id,
            "run_id": ctx.run_id,
            "agent_id": agent_id,
            "tool": tool_name,
            "ok": ok,
            "error": err,
            "latency_ms": round(latency, 1),
            "decision": decision,
            "ts": time.time(),
        }
    )

    return ToolResult(
        ok=ok,
        data=data,
        error=err,
        latency_ms=round(latency, 1),
        tool=tool_name,
        agent_id=agent_id,
        decision=decision,
    )


# ---------------------------------------------------------------------------
# PII redaction for the audit log / UI
# ---------------------------------------------------------------------------

_PII_KEYS = {"phone", "email", "name", "address", "customer_name", "verbatim"}


def _redact(d: Any, depth: int = 0) -> Any:
    if depth > 4:
        return "…"
    if isinstance(d, dict):
        return {
            k: ("***REDACTED***" if k.lower() in _PII_KEYS else _redact(v, depth + 1))
            for k, v in d.items()
        }
    if isinstance(d, list):
        return [_redact(x, depth + 1) for x in d[:10]]
    if isinstance(d, str) and len(d) > 200:
        return d[:200] + "…"
    return d


def args_hash(args: BaseModel | dict) -> str:
    import hashlib

    payload = args.model_dump() if isinstance(args, BaseModel) else args
    blob = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(blob).hexdigest()[:16]
