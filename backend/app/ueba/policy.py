"""
UEBA Layer A — deterministic policy enforcement.

Loads config/agent_policy.yaml and answers one question in microseconds:
    "Is this agent allowed to call this tool, with these arguments, right now?"

No LLM. No model inference. No network. Layer A must be fast enough that it
can sit in front of *every* tool call without anyone being tempted to skip it.
"""

from __future__ import annotations

import fnmatch
import re
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

IST = timezone(timedelta(hours=5, minutes=30))

POLICY_PATH = Path(__file__).resolve().parents[3] / "config" / "agent_policy.yaml"


# ---------------------------------------------------------------------------
# Violation model
# ---------------------------------------------------------------------------

@dataclass
class Violation:
    rule_id: str
    rule: str
    detail: str
    action: str          # BLOCK | FLAG
    weight: float = 1.0

    def as_dict(self) -> dict:
        return {
            "layer": "A",
            "rule_id": self.rule_id,
            "rule": self.rule,
            "detail": self.detail,
            "action": self.action,
            "weight": self.weight,
        }


@dataclass
class PolicyVerdict:
    violations: list[Violation] = field(default_factory=list)

    @property
    def score(self) -> float:
        """0.0 = clean, 1.0 = hard violation."""
        if not self.violations:
            return 0.0
        return min(1.0, max(v.weight for v in self.violations))

    @property
    def hard_block(self) -> bool:
        return any(v.action == "BLOCK" for v in self.violations)

    def reasons(self) -> list[dict]:
        return [v.as_dict() for v in self.violations]


# ---------------------------------------------------------------------------
# Rate limiting — sliding window per (agent, tool)
# ---------------------------------------------------------------------------

_SPEC_RE = re.compile(r"^\s*(\d+)\s*/\s*(sec|second|min|minute|hour|hr)\s*$", re.I)
_WINDOW = {"sec": 1, "second": 1, "min": 60, "minute": 60, "hour": 3600, "hr": 3600}


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)

    @staticmethod
    def _parse(spec: str) -> tuple[int, int]:
        m = _SPEC_RE.match(spec)
        if not m:
            raise ValueError(f"Bad rate-limit spec: {spec!r}")
        return int(m.group(1)), _WINDOW[m.group(2).lower()]

    def check(self, agent_id: str, tool: str, spec: str, now: float | None = None) -> tuple[bool, int, int]:
        limit, window = self._parse(spec)
        now = now if now is not None else time.time()
        q = self._hits[(agent_id, tool)]
        cutoff = now - window
        while q and q[0] < cutoff:
            q.popleft()
        used = len(q)
        if used >= limit:
            return False, used, limit
        q.append(now)
        return True, used + 1, limit

    def reset(self) -> None:
        self._hits.clear()


# ---------------------------------------------------------------------------
# Per-run scope accounting
# ---------------------------------------------------------------------------

class RunScope:
    """Tracks what a run has touched, so data_scope caps can be enforced."""

    def __init__(self) -> None:
        self.vins: dict[str, set[str]] = defaultdict(set)        # (run|agent) -> vins
        self.customers: dict[str, set[str]] = defaultdict(set)
        self.plans: dict[str, list[str]] = {}                    # run_id -> declared plan
        self.quarantined: dict[str, float] = {}                  # agent_id -> until_ts

    @staticmethod
    def _key(run_id: str, agent_id: str) -> str:
        return f"{run_id}|{agent_id}"

    def touch_vin(self, run_id: str, agent_id: str, vin: str | None) -> int:
        if vin:
            self.vins[self._key(run_id, agent_id)].add(vin)
        return len(self.vins[self._key(run_id, agent_id)])

    def touch_customer(self, run_id: str, agent_id: str, cid: str | None) -> int:
        if cid:
            self.customers[self._key(run_id, agent_id)].add(cid)
        return len(self.customers[self._key(run_id, agent_id)])

    def set_plan(self, run_id: str, steps: list[str]) -> None:
        self.plans[run_id] = list(steps)

    def in_plan(self, run_id: str, tool: str) -> bool:
        return tool in self.plans.get(run_id, [])

    def quarantine(self, agent_id: str, seconds: int) -> None:
        self.quarantined[agent_id] = time.time() + seconds

    def is_quarantined(self, agent_id: str) -> bool:
        until = self.quarantined.get(agent_id)
        if until is None:
            return False
        if time.time() > until:
            del self.quarantined[agent_id]
            return False
        return True

    def release(self, agent_id: str) -> None:
        self.quarantined.pop(agent_id, None)

    def clear_run(self, run_id: str) -> None:
        for d in (self.vins, self.customers):
            for k in [k for k in d if k.startswith(f"{run_id}|")]:
                del d[k]
        self.plans.pop(run_id, None)


# ---------------------------------------------------------------------------
# The engine
# ---------------------------------------------------------------------------

_SENSITIVITY_ORDER = {"public": 0, "internal": 1, "pii": 2, "restricted": 3}


class PolicyEngine:
    def __init__(self, path: Path | str = POLICY_PATH) -> None:
        self.path = Path(path)
        self.limiter = RateLimiter()
        self.scope = RunScope()
        self.reload()

    def reload(self) -> None:
        with open(self.path, encoding="utf-8") as f:
            self.cfg: dict[str, Any] = yaml.safe_load(f)
        self.agents = self.cfg.get("agents", {})
        self.clearance = self.cfg.get("clearance", {})
        self.scoring = self.cfg.get("scoring", {})
        self.default_decision = self.cfg.get("default_decision", "DENY")

    # -- helpers ---------------------------------------------------------

    def agent_cfg(self, agent_id: str) -> dict:
        return self.agents.get(agent_id, {})

    def allowed_tools(self, agent_id: str) -> list[str]:
        return list(self.agent_cfg(agent_id).get("allow", []))

    @staticmethod
    def _matches(patterns: list[str], tool: str) -> bool:
        return any(fnmatch.fnmatch(tool, p) for p in patterns)

    def matrix(self) -> dict:
        """Agent × tool grid for the Security Console UI (Slide 5, left panel)."""
        return {
            aid: {
                "display_name": c.get("display_name", aid),
                "color": c.get("color", "#64748b"),
                "allow": c.get("allow", []),
                "deny": c.get("deny", []),
                "rate_limits": c.get("rate_limits", {}),
                "data_scope": c.get("data_scope", {}),
                "clearance": self.clearance.get(aid, "internal"),
                "quarantined": self.scope.is_quarantined(aid),
            }
            for aid, c in self.agents.items()
        }

    # -- the hot path ----------------------------------------------------

    def evaluate(self, spec, args, ctx) -> PolicyVerdict:
        """
        spec: registry.ToolSpec | args: validated pydantic model | ctx: ToolContext
        """
        v = PolicyVerdict()
        agent_id = ctx.agent_id
        tool = spec.name
        acfg = self.agent_cfg(agent_id)
        a = args.model_dump() if hasattr(args, "model_dump") else dict(args)

        # 0. quarantine
        if self.scope.is_quarantined(agent_id):
            v.violations.append(
                Violation("Q0", "quarantined",
                          f"{agent_id} is quarantined by a prior UEBA block", "BLOCK", 1.0)
            )
            return v

        # 1. unknown agent → allowlist default
        if not acfg:
            v.violations.append(
                Violation("P0", "unknown_agent",
                          f"No policy entry for agent '{agent_id}'", "BLOCK", 1.0)
            )
            return v

        # 2. explicit deny (glob) — ATTACK 1 lands here
        if self._matches(acfg.get("deny", []), tool):
            v.violations.append(
                Violation("P1", "explicit_deny",
                          f"'{agent_id}' is explicitly denied '{tool}' — outside its role", "BLOCK", 1.0)
            )
            return v

        # 3. not in allowlist
        if not self._matches(acfg.get("allow", []), tool):
            v.violations.append(
                Violation("P2", "not_in_allowlist",
                          f"'{tool}' is not granted to '{agent_id}' (default={self.default_decision})",
                          "BLOCK" if self.default_decision == "DENY" else "FLAG", 1.0)
            )
            return v

        # 4. clearance ceiling
        have = _SENSITIVITY_ORDER.get(self.clearance.get(agent_id, "internal"), 1)
        need = _SENSITIVITY_ORDER.get(spec.sensitivity, 1)
        if need > have:
            v.violations.append(
                Violation("P3", "clearance_ceiling",
                          f"'{tool}' requires '{spec.sensitivity}' clearance; "
                          f"'{agent_id}' holds '{self.clearance.get(agent_id)}'", "BLOCK", 1.0)
            )

        # 5. G1 — VIN scope
        if spec.requires_vin_scope:
            arg_vin = a.get("vin")
            if arg_vin and ctx.vin and arg_vin != ctx.vin:
                v.violations.append(
                    Violation("G1", "vin_scope",
                              f"tool VIN {arg_vin} != run VIN {ctx.vin}", "BLOCK", 1.0)
                )

        # 6. G3 — irreversible must be planned
        if spec.side_effect == "irreversible" and not self.scope.in_plan(ctx.run_id, tool):
            v.violations.append(
                Violation("G3", "irreversible_requires_plan",
                          f"'{tool}' is irreversible and not in the declared plan for run {ctx.run_id}",
                          "BLOCK", 0.9)
            )

        # 7. rate limits — ATTACK 3 (mass cancel) lands here
        for pattern, spec_str in (acfg.get("rate_limits") or {}).items():
            if fnmatch.fnmatch(tool, pattern):
                ok, used, limit = self.limiter.check(agent_id, tool, spec_str)
                if not ok:
                    v.violations.append(
                        Violation("P4", "rate_limit",
                                  f"{agent_id} exceeded {spec_str} on '{tool}' ({used}/{limit})",
                                  "BLOCK", 0.85)
                    )

        # 8. data scope — ATTACK 2 lands here
        ds = acfg.get("data_scope") or {}
        if (cap := ds.get("max_distinct_vins_per_run")) is not None:
            n = self.scope.touch_vin(ctx.run_id, agent_id, a.get("vin") or ctx.vin)
            if n > cap:
                v.violations.append(
                    Violation("P5", "vin_enumeration",
                              f"{agent_id} touched {n} distinct VINs this run (cap {cap}) "
                              f"— possible fleet enumeration / exfiltration", "BLOCK", 1.0)
                )
        if (cap := ds.get("max_distinct_customers_per_run")) is not None:
            n = self.scope.touch_customer(ctx.run_id, agent_id, a.get("customer_id") or ctx.customer_id)
            if n > cap:
                v.violations.append(
                    Violation("G4", "pii_egress_cap",
                              f"{agent_id} touched {n} distinct customers this run (cap {cap})",
                              "FLAG", 0.7)
                )
        if ds.get("aggregate_only") and spec.sensitivity == "pii":
            v.violations.append(
                Violation("P6", "aggregate_only",
                          f"{agent_id} may only read aggregates; '{tool}' returns PII", "BLOCK", 1.0)
            )
        if (k := ds.get("min_cohort_size")) is not None and (n := a.get("cohort_size")) is not None:
            if n < k:
                v.violations.append(
                    Violation("P7", "k_anonymity",
                              f"cohort of {n} is below k={k}; re-identification risk", "BLOCK", 0.9)
                )

        # 9. time window — ATTACK 4 lands here (with Layer B)
        tw = acfg.get("time_window") or {}
        if tw:
            hour = getattr(ctx, "simulated_hour_ist", None)
            if hour is None:
                hour = datetime.now(IST).hour
            lo, hi = tw.get("allowed_hours_ist", [0, 23])
            if not (lo <= hour <= hi):
                v.violations.append(
                    Violation("P8", "off_hours",
                              f"{agent_id} active at {hour:02d}:00 IST, outside {lo:02d}–{hi:02d}",
                              tw.get("on_violation", "FLAG"), 0.6)
                )

        # 9b. G6/G7 — in-car safety. The server is the sole authority on
        #     drive_state; ctx carries it, the console never asserts it.
        #     Same engine as the security rules on purpose: an agent that can
        #     put a booking screen in front of a driver at 68 km/h is a hazard,
        #     and policy is how we prove it can't.
        drive_state = getattr(ctx, "drive_state", None) or a.get("drive_state")
        if drive_state:
            for g in self.cfg.get("global_rules", []):
                if g.get("id") == "G6":
                    unsafe = g.get("blocked_when_drive_state", [])
                    if tool in g.get("applies_to_tools", []) and drive_state in unsafe:
                        v.violations.append(
                            Violation("G6", "no_interaction_while_driving",
                                      f"'{tool}' requests driver interaction while "
                                      f"drive_state={drive_state}"
                                      + (f" ({a['speed_kmph']} km/h)" if a.get("speed_kmph") else "")
                                      + " — defer until PARKED",
                                      "BLOCK", 1.0)
                        )
                elif g.get("id") == "G7":
                    cap = g.get("max_elements_when_driving", 1)
                    n = a.get("elements") or a.get("slots") or a.get("options")
                    n = len(n) if isinstance(n, list) else n
                    if drive_state in ("DRIVING", "STOPPED_BRIEF") and isinstance(n, int) and n > cap:
                        v.violations.append(
                            Violation("G7", "single_element_while_driving",
                                      f"'{tool}' would render {n} elements while "
                                      f"{drive_state} (NHTSA 2s glance limit → max {cap})",
                                      g.get("on_violation", "FLAG"), 0.6)
                        )

        # 10. G5 — off-hours *customer contact* for everyone else.
        #     Scoped to side_effect="external" on purpose: writing a booking row at
        #     02:00 is harmless, phoning the owner at 02:00 is not. Narrowing this
        #     keeps the FLAG signal meaningful instead of firing on every night build.
        if spec.side_effect == "external" and not tw:
            hour = getattr(ctx, "simulated_hour_ist", None) or datetime.now(IST).hour
            if not (7 <= hour <= 22) and ctx.model_dump().get("trigger") != "urgent_p1":
                v.violations.append(
                    Violation("G5", "business_hours_contact",
                              f"customer contact ({spec.name}) at {hour:02d}:00 IST, outside 07–22", "FLAG", 0.5)
                )

        return v

    # -- quarantine ------------------------------------------------------

    def quarantine(self, agent_id: str) -> int:
        secs = int((self.scoring.get("quarantine") or {}).get("duration_seconds", 300))
        self.scope.quarantine(agent_id, secs)
        return secs

    def release(self, agent_id: str) -> None:
        self.scope.release(agent_id)


# module-level singleton
engine = PolicyEngine()
