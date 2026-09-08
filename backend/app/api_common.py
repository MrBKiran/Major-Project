"""
Shared API concerns: pagination, correlation ids, error shape.

Pagination is offset-based with a hard ceiling. Keyset ("cursor") pagination is
the better answer for very large, naturally-ordered tables and is what the
telemetry endpoints should use if they ever return raw rows — but the fleet and
appointment lists are sorted by computed severity, where a keyset cursor has no
stable column to seek on. Offset with a capped limit is the honest choice here;
what matters for scale is that the ceiling exists, so no caller can ask for
40,000 vehicles in one response.
"""

from __future__ import annotations

from dataclasses import dataclass

from fastapi import Query

DEFAULT_LIMIT = 50
MAX_LIMIT = 200


@dataclass(frozen=True)
class Page:
    limit: int
    offset: int

    def envelope(self, items: list, total: int | None = None) -> dict:
        """Wrap rows with the metadata a client needs to page.

        `total` is optional because counting a large filtered set costs a second
        full scan; endpoints that can get it cheaply pass it, the rest report
        `has_more` from an over-fetch instead.
        """
        meta = {"limit": self.limit, "offset": self.offset, "count": len(items)}
        if total is not None:
            meta["total"] = total
            meta["has_more"] = self.offset + len(items) < total
        return meta


def page_params(
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT,
                        description=f"Rows to return (max {MAX_LIMIT})."),
    offset: int = Query(0, ge=0, description="Rows to skip."),
) -> Page:
    return Page(limit=limit, offset=offset)
