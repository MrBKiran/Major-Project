"""
Grounded answers to an owner's questions.

The distinction from `persuasion.py` is the point of this module: persuasion
picks a named strategy and renders a claim the agent already wanted to make.
Answering starts from the owner's question and is allowed to say "I don't know",
which no persuasion strategy can. Both speak in the same voice; only one of them
is steerable by whoever is typing.

Every fact in the prompt arrives as a pre-fetched value gathered by the agents
entitled to fetch it — `build_answer_facts` does no I/O of its own. That is not
tidiness, it is the policy boundary: config/agent_policy.yaml denies
`telemetry.*` and `ml.*` to customer_engagement_agent on purpose ("gets its
facts from the Diagnosis output"), so the speaking agent must never be the one
that reads them. api_chat.py collects them under diagnosis_agent and hands the
result here.

The refusal instruction in the system prompt is load-bearing. A service advisor
that invents a price or a date is worse than one that says it will check, and a
model given a short fact list will otherwise happily fill the gaps.
"""

from __future__ import annotations

from typing import Any

from app.llm.router import complete

SYSTEM = (
    "You are an honest Indian OEM service advisor answering a vehicle owner's "
    "question about their own vehicle. Answer only from the facts given to you. "
    "If a fact you need is not listed, say plainly that you will check and come "
    "back — never invent a number, a date, a part or a price. Keep it to two "
    "short sentences, warm and plain-spoken, no jargon. Rupee amounts are in INR. "
    "If earlier turns are shown, use them to understand what the owner is "
    "referring to, and do not repeat a greeting you have already given."
)

# Owner-facing names. The raw column values are engineering identifiers, and
# reading "brake_pads" aloud to a customer is how a demo gets called AI-made.
COMPONENT_LABELS = {
    "brake_pads": "brake pads",
    "water_pump": "water pump",
    "battery": "battery",
    "fuel_injector": "fuel injector",
    "oil_pump": "oil pump",
}


def _fmt_money(value: Any) -> str | None:
    try:
        return f"₹{float(value):,.0f}"
    except (TypeError, ValueError):
        return None


def build_answer_facts(
    *,
    vehicle: dict | None,
    customer: dict | None,
    prediction: dict | None,
    reading: str | None = None,
    economics: dict | None = None,
    history: list[dict] | None = None,
    dtcs: list[dict] | None = None,
    appointment: dict | None = None,
    offered_slots: list[dict] | None = None,
    travel: dict | None = None,
) -> list[str]:
    """Flatten whatever was gathered into plain factual lines for the prompt.

    Absent values are omitted rather than rendered as "unknown": a line reading
    "Cost: unknown" invites the model to guess at it, whereas a fact that simply
    is not there lands on the refusal instruction instead.
    """
    facts: list[str] = []

    if customer and customer.get("name"):
        facts.append(f"Owner name: {customer['name']}")
    if vehicle:
        if vehicle.get("model"):
            facts.append(f"Vehicle: {vehicle['model']} (VIN {vehicle.get('vin', '')})".strip())
        # `odometer` is the column name in db/queries.vehicle_info; accept the
        # _km spelling too so a caller passing the simulator's shape still works.
        odo = vehicle.get("odometer", vehicle.get("odometer_km"))
        if odo is not None:
            facts.append(f"Odometer: {int(odo):,} km")
        if vehicle.get("city"):
            facts.append(f"Registered city: {vehicle['city']}")

    if prediction:
        component = prediction.get("component")
        label = COMPONENT_LABELS.get(component, str(component or "").replace("_", " "))
        facts.append(f"Predicted issue: {label}")
        if prediction.get("failure_prob") is not None:
            facts.append(f"Confidence this is failing: {float(prediction['failure_prob']) * 100:.0f}%")
        if prediction.get("days_to_failure") is not None:
            facts.append(f"Estimated time until failure: {float(prediction['days_to_failure']):.1f} days")
        if prediction.get("severity"):
            facts.append(f"Priority: {prediction['severity']} (P1 is most urgent)")
    else:
        facts.append("No active predicted issue for this vehicle right now.")

    if reading:
        facts.append(f"Latest sensor reading behind this prediction: {reading}")

    if economics:
        if (cost := _fmt_money(economics.get("repair_cost"))):
            facts.append(f"Cost to fix now: {cost}")
        if (bad := _fmt_money(economics.get("breakdown_cost"))):
            facts.append(f"Cost if it fails on the road instead: {bad}")
        if economics.get("repair_minutes"):
            facts.append(f"Time the repair takes: {economics['repair_minutes']} minutes")

    if dtcs:
        for d in dtcs[:3]:
            desc = d.get("description") or d.get("component") or ""
            facts.append(f"Active fault code {d.get('code', '')}: {desc}".strip())

    if history:
        for rec in history[:3]:
            when = str(rec.get("date") or "")[:10]
            what = rec.get("service_type") or "service"
            parts = rec.get("components_replaced") or []
            line = f"Past service on {when}: {what}"
            if parts:
                line += f" (replaced {', '.join(str(p) for p in parts)})"
            if (cost := _fmt_money(rec.get("cost"))):
                line += f", {cost}"
            facts.append(line)
    elif history is not None:
        facts.append("No past service records on file for this vehicle.")

    if appointment:
        facts.append(
            f"Existing appointment: {appointment.get('slot_start', '')} "
            f"at {appointment.get('center_id', '')}".strip()
        )

    if offered_slots:
        slot = offered_slots[0]
        facts.append(
            f"Earliest slot available: {slot.get('slot_start', '')} "
            f"at {slot.get('center_name') or slot.get('center_id', '')}".strip()
        )

    # "How far is it?" is one of the first things an owner asks, and it is now
    # answerable from real centre coordinates. The estimate carries its own
    # hedge so the agent does not present a road-factor approximation as a
    # routed journey time.
    if travel and travel.get("minutes") is not None:
        facts.append(
            f"Travel to the service centre: about {travel['minutes']} minutes "
            f"({travel.get('distance_km')} km by road, estimated — not live traffic)"
        )

    return facts


def format_history(history: list[dict]) -> str:
    """Prior turns as a readable transcript for the prompt."""
    if not history:
        return ""
    lines = [f"{'Owner' if h.get('role') == 'user' else 'You'}: {h.get('text', '')}"
             for h in history if h.get("text")]
    return "\n".join(lines)


async def answer_question(question: str, facts: list[str],
                          history: list[dict] | None = None) -> dict:
    """Answer `question` using only `facts`. Returns the same shape as
    `persuasion.next_turn` so the chat endpoint can treat turns uniformly.

    `history` carries the conversation so far. Without it a follow-up like
    "how much did you say?" or "is that the Saturday one?" has no referent and
    the model either guesses or asks the owner to repeat themselves — the exact
    goldfish-memory behaviour that makes an assistant feel fake. Facts remain
    the only source of truth; history is there to resolve what is being asked
    about, not to add new claims.
    """
    fact_block = "\n".join(f"- {f}" for f in facts) or "- (no facts available)"
    transcript = format_history(history or [])
    prompt = (
        (f"Conversation so far:\n{transcript}\n\n" if transcript else "")
        + f"Known facts about this owner's vehicle:\n{fact_block}\n\n"
        f"The owner asks: {question}\n\nAnswer them."
    )
    # No fixture_key on purpose — there is no canned answer to an arbitrary
    # question, and falling back to one would answer something never asked.
    text, source = await complete(prompt, system=SYSTEM)
    if source in ("demo_fixture", "static_fallback") or not (text or "").strip():
        text = (
            "I don't have a live line to the workshop system this second — "
            "let me check and come straight back to you on that."
        )
        source = "static_fallback"
    return {"strategy": "ANSWER", "text": text, "source": source}
