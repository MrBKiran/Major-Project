"""
Owner-utterance intent routing for the live chat.

The batch call flow only ever had to answer one question — "did they say yes,
or do I counter an objection?" — because a scripted run never wanders. A live
owner does: they ask *why*, they ask *how much*, they ask what the last service
was, and none of that is an objection to be countered. Answering "let me hold
that slot for you" to "what's actually wrong with it?" is the single thing that
makes a demo feel like a script instead of an agent.

Four intents, deliberately: ACCEPT / DECLINE / QUESTION / OBJECTION. OBJECTION
is the default because it is the safe landing spot — it routes into the
existing, well-tested persuasion counter path, so a misclassification degrades
to the old behaviour rather than to a dead end.

Classification is LLM-first with a deterministic fallback, in that order and
not the reverse: the keyword rules exist so a dead provider (or an exhausted
free tier mid-demo) still routes sensibly, not as the primary mechanism.
"""

from __future__ import annotations

import logging

from app.graph.nodes.customer_engagement import ACCEPT_PHRASES
from app.llm.router import complete

logger = logging.getLogger("autosaarthi.llm")

INTENTS = ("ACCEPT", "DECLINE", "QUESTION", "OBJECTION")
DEFAULT_INTENT = "OBJECTION"

# Firm refusals — distinct from an objection, which is hesitation the agent is
# invited to answer. "Not interested" is a request to stop, and continuing to
# persuade past it is exactly the behaviour that gets a service line blocked.
_DECLINE_PHRASES = [
    "not interested", "no thanks", "no thank you", "stop calling", "don't call",
    "do not call", "leave me alone", "remove me", "unsubscribe", "nahi chahiye",
]

_QUESTION_OPENERS = (
    "what", "why", "how", "when", "where", "which", "who", "whose",
    "is ", "are ", "can ", "could ", "do ", "does ", "did ", "should ",
    "will ", "would ", "kya ", "kaun ", "kitna ", "kitne ", "kab ",
)

_SYSTEM = (
    "You classify one message from a vehicle owner talking to a service advisor. "
    "Reply with exactly one word and nothing else, chosen from: "
    "ACCEPT, DECLINE, QUESTION, OBJECTION.\n"
    "ACCEPT = agrees to book the service.\n"
    "DECLINE = firmly refuses or asks to not be contacted.\n"
    "QUESTION = asks for information (what is wrong, why, how much, when, history).\n"
    "OBJECTION = hesitates, pushes back on cost or timing, or stalls."
)


def _fallback(utterance: str) -> str:
    """Deterministic routing — also the arbiter when the LLM answers nonsense."""
    text = (utterance or "").strip().lower()
    if not text:
        return DEFAULT_INTENT
    if any(p in text for p in _DECLINE_PHRASES):
        return "DECLINE"
    if any(p in text for p in ACCEPT_PHRASES):
        return "ACCEPT"
    # A question mark is strong evidence, but plenty of spoken questions carry
    # no punctuation at all ("how much will it cost") — hence the openers too.
    if text.endswith("?") or text.startswith(_QUESTION_OPENERS):
        return "QUESTION"
    return DEFAULT_INTENT


async def classify_intent(utterance: str, history: list[dict] | None = None) -> tuple[str, str]:
    """Returns (intent, source) where source is "llm" or "fallback".

    The source is threaded back to the caller and surfaced in the UI for the
    same reason `llm.persuade` reports its own: a demo claim that the routing
    is live should be checkable on screen, not taken on trust.

    `history` matters more here than it looks: a bare "yes" or "how much?" is
    ambiguous in isolation and only means something against what was just
    asked. The keyword fallback cannot use it, which is part of why the LLM
    path is preferred rather than the other way round.
    """
    text = (utterance or "").strip()
    if not text:
        return DEFAULT_INTENT, "fallback"

    guess = _fallback(text)
    prior = ""
    if history:
        last = [h for h in history if h.get("text")][-3:]
        if last:
            prior = "Conversation so far:\n" + "\n".join(
                f"{'Owner' if h.get('role') == 'user' else 'Advisor'}: {h['text']}"
                for h in last
            ) + "\n\n"
    try:
        # No fixture_key: this must never be short-circuited by DEMO_MODE. A
        # canned intent would make every typed message route identically,
        # which is precisely the "it's mocked" complaint this module answers.
        raw, provider = await complete(f"{prior}Message: {text}", system=_SYSTEM)
    except Exception as e:  # noqa: BLE001 — routing must not break the chat
        logger.warning("intent classification failed (%s) — using fallback", e)
        return guess, "fallback"

    if provider in ("demo_fixture", "static_fallback"):
        return guess, "fallback"

    # Substring rather than equality: small models like to answer "OBJECTION."
    # or "The intent is QUESTION". Longest-first so OBJECTION never matches
    # inside a longer word before the exact intent is seen.
    upper = (raw or "").strip().upper()
    for intent in sorted(INTENTS, key=len, reverse=True):
        if intent in upper:
            return intent, "llm"
    return guess, "fallback"
