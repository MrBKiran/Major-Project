"""
DEMO_MODE scripted customer replies for voice.listen — sourced from each
vehicle's own `arc.console_arc` / `arc.scripted_objections` /
`arc.expected_outcome` in simulator/vehicles.yaml, so the objection-handling
demo (declines → re-plan → accepts) is the exact scripted moment the plan
calls the "money shot" (§5.2), not an improvised guess.

Falls back to a generic line derived from `expected_outcome` for vehicles
that don't script an explicit conversation.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[3]
VEHICLES_YAML = ROOT / "simulator" / "vehicles.yaml"

ACCEPT_LINE = "Haan, theek hai. Book kar do."
DECLINE_LINE = "Abhi nahi, mujhe sochne do."
# Post-service reply. The Feedback Agent asks for a rating at a turn index past
# the end of any booking script, so it falls through to this line.
FEEDBACK_LINE = "Bahut badhiya service thi, thank you."


@lru_cache(maxsize=1)
def _doc() -> dict:
    return yaml.safe_load(VEHICLES_YAML.read_text(encoding="utf-8"))


@lru_cache(maxsize=32)
def _turns_for_vin(vin: str) -> tuple[str, ...]:
    spec = next((s for s in _doc().get("vehicles", []) if s["vin"] == vin), None)
    if not spec:
        return (ACCEPT_LINE,)
    arc = spec.get("arc") or {}
    outcome = arc.get("expected_outcome", "")

    console_lines = [t["driver_utterance"] for t in (arc.get("console_arc") or []) if "driver_utterance" in t]
    if console_lines:
        return tuple(console_lines)

    objections = [o["objection"] for o in (arc.get("scripted_objections") or [])]
    if objections:
        closer = ACCEPT_LINE if "declin" not in outcome or "accept" in outcome else DECLINE_LINE
        return (*objections, closer)

    if "declin" in outcome and "accept" not in outcome:
        return (DECLINE_LINE,)
    return (ACCEPT_LINE,)


FEEDBACK_TURN = 9      # sentinel used by the Feedback Agent


def scripted_reply(vin: str, turn_index: int) -> str:
    if turn_index >= FEEDBACK_TURN:
        return FEEDBACK_LINE
    turns = _turns_for_vin(vin)
    return turns[min(turn_index, len(turns) - 1)]
