"""
PDF rendering for the three report kinds `report.render_pdf` accepts.

Kept out of tools/core.py because the tool's job is to be a governed entry
point, not to know about page geometry — and because a report generator is
worth testing on its own without going through the registry and the guard.

Everything rendered here comes from the payload the caller assembled. This
module fetches nothing: a CAPA leaving the system toward manufacturing is a
`notify.plant` decision that already requires human approval, and a renderer
that could also go and read rows would be a second, unpoliced path to the same
data.
"""

from __future__ import annotations

import datetime as dt
import re
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
)

REPORTS_DIR = Path(__file__).resolve().parents[2] / "data" / "reports"

INK = colors.HexColor("#16181d")
DIM = colors.HexColor("#4e5560")
RULE = colors.HexColor("#d7dade")
ACCENT = colors.HexColor("#b03024")


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle("t", parent=base["Title"], fontName="Times-Bold",
                                fontSize=19, leading=23, textColor=INK, alignment=TA_LEFT,
                                spaceAfter=2),
        "sub": ParagraphStyle("s", parent=base["Normal"], fontName="Courier",
                              fontSize=8.5, leading=12, textColor=DIM, spaceAfter=14),
        "h": ParagraphStyle("h", parent=base["Heading2"], fontName="Times-Bold",
                            fontSize=11.5, leading=14, textColor=INK,
                            spaceBefore=12, spaceAfter=4),
        "body": ParagraphStyle("b", parent=base["Normal"], fontName="Times-Roman",
                               fontSize=10, leading=14.5, textColor=INK, spaceAfter=6),
        "note": ParagraphStyle("n", parent=base["Normal"], fontName="Times-Italic",
                               fontSize=8.5, leading=12, textColor=DIM, spaceBefore=10),
    }


# reportlab's built-in Type-1 faces cover Latin-1 only, so a rupee sign, a
# typographic dash or a middle dot renders as a black box. Every string that
# reaches a Paragraph goes through here: this app's own copy is full of ₹ and
# em-dashes, and a report that silently corrupts a price is worse than one that
# spells it "Rs".
_TRANSLIT = {
    "₹": "Rs ",  # ₹
    "·": "-",    # ·
    "—": " - ",  # —
    "–": "-",    # –
    "‘": "'", "’": "'",
    "“": '"', "”": '"',
    "…": "...",
    " ": " ",
}


def _txt(value: Any) -> str:
    """Latin-1-safe text for a Paragraph, with XML metacharacters escaped.

    Escaping matters as much as transliteration: Paragraph parses its input as
    markup, so an unescaped '&' or '<' in a defect description raises rather
    than rendering.
    """
    s = "" if value is None else str(value)
    for bad, good in _TRANSLIT.items():
        s = s.replace(bad, good)
    s = s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    # anything still outside Latin-1 would render as a box
    return s.encode("latin-1", "replace").decode("latin-1")


def _safe_stem(*parts: Any) -> str:
    """Filenames come from caller-supplied ids, so strip anything that could
    escape the reports directory or confuse a shell."""
    raw = "-".join(str(p) for p in parts if p)
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", raw).strip("-.")
    return (cleaned or "report")[:80]


def _kv_table(rows: list[tuple[str, Any]], width: float) -> Table:
    st = _styles()
    data = [[Paragraph(f"<b>{_txt(k)}</b>", st["body"]), Paragraph(_txt(v), st["body"])]
            for k, v in rows]
    t = Table(data, colWidths=[width * 0.30, width * 0.70])
    t.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, -2), 0.4, RULE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _paragraphs(st: dict, heading: str, text: Any) -> list:
    if not text:
        return []
    return [Paragraph(_txt(heading), st["h"]), Paragraph(_txt(text), st["body"])]


def render(kind: str, payload: dict[str, Any], run_id: str | None = None) -> dict:
    """Render `payload` and return {path, kind, bytes}. Raises ValueError on an
    unknown kind so a typo fails loudly instead of writing an empty document."""
    if kind not in ("capa", "run_summary", "service_report"):
        raise ValueError(f"unknown report kind {kind!r}")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    st = _styles()
    now = dt.datetime.now(dt.timezone.utc).astimezone()
    stamp = now.strftime("%Y%m%d-%H%M%S")

    ident = (payload.get("capa_id") or payload.get("vin")
             or payload.get("run_id") or run_id or "")
    path = REPORTS_DIR / f"{_safe_stem(kind, ident, stamp)}.pdf"

    doc = SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"AutoSaarthi {kind} report", author="AutoSaarthi",
    )
    W = doc.width
    flow: list = []

    titles = {"capa": "Corrective & Preventive Action",
              "run_summary": "Agent Run Summary",
              "service_report": "Service Report"}
    flow += [Paragraph(_txt(titles[kind]), st["title"])]
    flow += [Paragraph(
        _txt(f"AutoSaarthi | generated {now.strftime('%d %b %Y %H:%M')}"
             + (f" | run {run_id}" if run_id else "")), st["sub"])]

    if kind == "capa":
        flow += [_kv_table([
            ("CAPA ID", payload.get("capa_id")),
            ("Component", payload.get("component")),
            ("Defect mode", payload.get("defect_mode")),
            ("Batch", payload.get("batch_id")),
            ("Plant", payload.get("plant")),
            ("Status", payload.get("status", "draft")),
            ("Affected vehicles", payload.get("affected_count")),
        ], W)]
        flow += _paragraphs(st, "Root cause", payload.get("root_cause"))
        flow += _paragraphs(st, "Corrective action", payload.get("corrective_action"))
        flow += _paragraphs(st, "Preventive action", payload.get("preventive_action"))
        five_why = payload.get("five_why") or []
        if five_why:
            flow += [Paragraph("Five whys", st["h"])]
            for i, why in enumerate(five_why, 1):
                flow += [Paragraph(_txt(f"{i}. {why}"), st["body"])]

    elif kind == "run_summary":
        flow += [_kv_table([
            ("Run", payload.get("run_id") or run_id),
            ("Vehicle", payload.get("vin")),
            ("Trigger", payload.get("trigger")),
            ("Outcome", payload.get("outcome")),
        ], W)]
        steps = payload.get("steps") or []
        if steps:
            flow += [Paragraph("Tool calls", st["h"])]
            data = [["#", "Agent", "Tool", "Decision"]] + [
                [str(i), _txt(s.get("agent_id", "")), _txt(s.get("tool", "")),
                 _txt(s.get("decision", ""))]
                for i, s in enumerate(steps, 1)]
            t = Table(data, colWidths=[W*0.07, W*0.30, W*0.45, W*0.18])
            t.setStyle(TableStyle([
                ("FONTNAME", (0, 0), (-1, 0), "Times-Bold"),
                ("FONTNAME", (0, 1), (-1, -1), "Courier"),
                ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                ("TEXTCOLOR", (0, 0), (-1, -1), INK),
                ("LINEBELOW", (0, 0), (-1, 0), 0.7, INK),
                ("LINEBELOW", (0, 1), (-1, -2), 0.3, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ]))
            # Colour any refusal so a blocked call is visible at a glance.
            for i, s in enumerate(steps, 1):
                if str(s.get("decision")) in ("BLOCK", "FLAG"):
                    t.setStyle(TableStyle([("TEXTCOLOR", (3, i), (3, i), ACCENT)]))
            flow += [t]

    else:  # service_report
        flow += [_kv_table([
            ("Vehicle", payload.get("vin")),
            ("Model", payload.get("model")),
            ("Appointment", payload.get("appointment_id")),
            ("Service centre", payload.get("center_id")),
            ("Scheduled", payload.get("slot_start")),
            ("Component", payload.get("component")),
            ("Estimate", payload.get("cost")),
        ], W)]
        flow += _paragraphs(st, "Findings", payload.get("notes"))
        parts = payload.get("parts") or []
        if parts:
            flow += [Paragraph("Parts", st["h"]),
                     Paragraph(_txt(", ".join(str(p) for p in parts)), st["body"])]

    flow += [Spacer(1, 8)]
    flow += [KeepTogether([Paragraph(
        "Generated by the AutoSaarthi agent platform. Figures are produced by the "
        "models and rules described in the system documentation; this document is a "
        "record of what the system computed, not an engineering sign-off.", st["note"])])]

    doc.build(flow)
    return {"path": str(path), "kind": kind, "bytes": path.stat().st_size}
