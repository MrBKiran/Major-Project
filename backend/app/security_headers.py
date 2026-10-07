"""
Response headers that belong on every reply, plus one that belongs on credentials.

  X-Content-Type-Options: nosniff   on everything — a JSON body must never be reinterpreted
                                    as script or markup by a browser that guesses.
  Cache-Control: no-store           on /api/auth/* and the operator health detail — those
                                    carry sessions, second-factor secrets and one-time-code
                                    state, and must not survive in a browser or proxy cache.
                                    Applied selectively: blanket no-store would switch off
                                    caching everywhere for no gain.
"""

from __future__ import annotations

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

_NO_STORE_PREFIXES = ("/api/auth/", "/api/health/detail")


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        if request.url.path.startswith(_NO_STORE_PREFIXES):
            response.headers["Cache-Control"] = "no-store"
        return response
