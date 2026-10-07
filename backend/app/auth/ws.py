"""
WebSocket authentication.

HTTP routes are guarded by a dependency that reads the Authorization header, but
a browser cannot set that header on a WebSocket, and putting the token in the URL
would leave it in access logs and proxy logs. So the credential is the first
message on the socket: {"type": "auth", "token": "<jwt>"}.

The socket is accepted (a close code can only be delivered on an accepted
connection) but nothing is sent until that message arrives and checks out — the
same checks an HTTP request gets, via resolve_principal.

Close codes are in the 4xxx application range and mirror HTTP:
  4401 — no usable credential (absent, malformed, expired, revoked, timed out)
  4403 — a known account that is not allowed (deactivated, wrong role, no permission)
  4429 — rate limited
"""

from __future__ import annotations

import asyncio
import json

from fastapi import HTTPException, WebSocket

from app.auth.deps import resolve_principal
from app.config import settings

UNAUTHENTICATED = 4401
FORBIDDEN = 4403
RATE_LIMITED = 4429

# A JWT is a few hundred bytes; anything near this is not a credential.
MAX_AUTH_FRAME_CHARS = 8 * 1024


def close_code_for(status_code: int) -> int:
    return {403: FORBIDDEN, 429: RATE_LIMITED}.get(status_code, UNAUTHENTICATED)


async def close_with(ws: WebSocket, code: int) -> None:
    try:
        # Generic on purpose: the reason string reaches the client, so it says
        # which class of failure this was and nothing about why.
        await ws.close(code=code, reason="forbidden" if code == FORBIDDEN else "unauthenticated")
    except RuntimeError:
        pass  # the peer already went away


async def authenticate(ws: WebSocket, permission: str) -> str | None:
    """Wait for the auth message and check it. Returns the token if the caller may
    proceed; otherwise closes the socket and returns None."""
    try:
        message = await asyncio.wait_for(ws.receive(), timeout=settings.ws_auth_timeout_s)
    except asyncio.TimeoutError:
        await close_with(ws, UNAUTHENTICATED)
        return None
    if message["type"] != "websocket.receive":     # the client disconnected first
        return None

    raw = message.get("text")                      # None for a binary frame
    if not isinstance(raw, str) or len(raw) > MAX_AUTH_FRAME_CHARS:
        await close_with(ws, UNAUTHENTICATED)
        return None
    try:
        body = json.loads(raw)
    except ValueError:
        await close_with(ws, UNAUTHENTICATED)
        return None

    token = body.get("token") if isinstance(body, dict) and body.get("type") == "auth" else None
    if not isinstance(token, str) or not token:
        await close_with(ws, UNAUTHENTICATED)
        return None

    code = revalidate(token, permission)
    if code is not None:
        await close_with(ws, code)
        return None
    return token


def revalidate(token: str, permission: str) -> int | None:
    """None while the token still grants `permission`; otherwise the code to close with.

    Run at connect and again periodically on an open stream, so logging out,
    revoking a user's sessions, deactivating them or changing their role ends the
    stream within one recheck interval instead of whenever the token expires.
    """
    try:
        principal = resolve_principal(token)
    except HTTPException as exc:
        return close_code_for(exc.status_code)
    return None if principal.can(permission) else FORBIDDEN
