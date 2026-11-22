"""One model step with tool calling, over the providers app/llm/router.py already holds.

Groq first, Gemini if Groq errors, and `LlmUnavailable` if neither is configured or
both fail — the caller then answers from the facts alone rather than not at all.
Kept to a single function so a test can swap in a scripted model.
"""

from __future__ import annotations

import json
import logging
from typing import Awaitable, Callable

from app.llm import router

logger = logging.getLogger("autosaarthi.assistant")

# A step is {"content": str, "tool_calls": [{"id", "name", "args"}], "source": "groq"|"gemini"|...}
ModelStep = dict
ChatModel = Callable[[list[dict], list[dict]], Awaitable[ModelStep]]


class LlmUnavailable(RuntimeError):
    pass


def _to_langchain(messages: list[dict]):
    from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage

    out = []
    for m in messages:
        role = m["role"]
        if role == "system":
            out.append(SystemMessage(content=m["content"]))
        elif role == "user":
            out.append(HumanMessage(content=m["content"]))
        elif role == "assistant":
            out.append(AIMessage(content=m.get("content") or "",
                                 tool_calls=[{"id": c["id"], "name": c["name"], "args": c["args"]}
                                             for c in m.get("tool_calls", [])]))
        elif role == "tool":
            out.append(ToolMessage(content=m["content"], tool_call_id=m["tool_call_id"], name=m.get("name")))
    return out


def _text(content) -> str:
    """Gemini returns a list of parts; Groq returns a string."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(p if isinstance(p, str) else p.get("text", "") for p in content)
    return ""


async def chat_step(messages: list[dict], tools: list[dict]) -> ModelStep:
    lc = _to_langchain(messages)
    for name, get_client in (("groq", router._get_groq), ("gemini", router._get_gemini)):
        client = get_client()
        if client is None:
            continue
        try:
            bound = client.bind_tools(tools) if tools else client
            resp = await bound.ainvoke(lc)
        except Exception as exc:  # noqa: BLE001 — a dead provider must not end the conversation
            logger.warning("assistant: provider %s failed: %s", name, exc)
            continue
        calls = [{"id": c.get("id") or f"call_{i}", "name": c["name"], "args": c.get("args") or {}}
                 for i, c in enumerate(getattr(resp, "tool_calls", None) or [])]
        return {"content": _text(resp.content), "tool_calls": calls, "source": name}
    raise LlmUnavailable("no language model reachable")


def dumps(result: dict) -> str:
    """A tool result as the model reads it; bounded so one huge answer cannot crowd out the rest."""
    return json.dumps(result, ensure_ascii=False, default=str)[:6000]
