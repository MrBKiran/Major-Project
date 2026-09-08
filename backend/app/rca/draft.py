"""
CAPA ticket drafting — turns a defect cluster plus retrieved history into a
ticket a plant quality engineer can act on.

The 5-Why chain is *grounded*: every step is either a statistic computed from
the maintenance data or a line traceable to a cited historical CAPA. An
ungrounded 5-Why is just plausible-sounding text, and a manufacturing team
acting on a hallucinated root cause is worse than no insight at all — so the
cited CAPA ids travel with the draft and appear on the ticket.
"""

from __future__ import annotations

import datetime as dt
from functools import lru_cache
from pathlib import Path

import yaml

from app.rca.corpus import search

ROOT = Path(__file__).resolve().parents[3]
VEHICLES_YAML = ROOT / "simulator" / "vehicles.yaml"

# Confidence floor for treating a retrieved CAPA as precedent. Below this the
# draft still goes out, but flagged as unsupported rather than citing a
# document that merely shares vocabulary.
PRECEDENT_MIN_SCORE = 0.25


@lru_cache(maxsize=1)
def _breakdown_costs() -> dict[str, int]:
    doc = yaml.safe_load(VEHICLES_YAML.read_text(encoding="utf-8"))
    return {d["component"]: d.get("breakdown_cost_inr", 20000)
            for d in doc["degradations"].values()}


def _answer_of(five_why_line: str, fallback: str) -> str:
    """Return just the answer half of a "Why X? Because Y." corpus line."""
    if not five_why_line:
        return fallback
    head, sep, tail = five_why_line.partition("? ")
    return (tail or head).strip() if sep else five_why_line.strip()


def _cluster_query(cluster: dict) -> str:
    comp = cluster["component"].replace("_", " ")
    notes = " ".join(cluster.get("example_notes") or [])
    return f"{comp} {cluster.get('plant', '')} {notes}"


def build_five_why(cluster: dict, precedent: dict | None) -> list[dict]:
    """Each step carries its own evidence, so the chain can be audited."""
    comp = cluster["component"].replace("_", " ")
    chain = [
        {
            "why": f"Why are {comp} failures elevated in {cluster['batch_id']}?",
            "because": (
                f"{cluster['failures']} of {cluster['cohort_size']} vehicles in that lot "
                f"({cluster['failure_rate']:.1%}) have had the {comp} replaced, against a "
                f"fleet baseline of {cluster['baseline_rate']:.1%}."
            ),
            "evidence": f"lift {cluster['lift']}x, p={cluster['p_value']}, q={cluster['q_value']}",
        },
        {
            "why": "Why is this lot different from the rest of the parc?",
            "because": (
                f"The failures are confined to units built at {cluster['plant']} within this "
                f"batch, which points at a build- or supply-side change rather than "
                f"in-service duty."
            ),
            "evidence": f"cohort scoped to {cluster['component']} | {cluster['plant']} | {cluster['batch_id']}",
        },
    ]
    if precedent:
        chain += [
            {
                "why": "Why would a build-side change produce this failure mode?",
                "because": precedent["defect_mode"],
                "evidence": f"matches historical {precedent['capa_id']} (similarity {precedent['score']})",
            },
            {
                "why": "What was the mechanism in that precedent?",
                "because": precedent["root_cause"],
                "evidence": f"{precedent['capa_id']} root-cause section",
            },
            {
                "why": "Why was it not caught before shipping?",
                # Corpus 5-Why entries are stored as "Why X? Because Y." Splicing
                # one in whole made the answer start with a question of its own,
                # which reads as a formatting bug on the slide.
                "because": _answer_of(
                    precedent["five_why"][-1] if precedent.get("five_why") else "",
                    fallback="The control plan had no gate for this characteristic.",
                ),
                "evidence": f"{precedent['capa_id']} 5-Why, final step",
            },
        ]
    else:
        chain.append({
            "why": "Why would a build-side change produce this failure mode?",
            "because": "No sufficiently similar historical CAPA was retrieved — mechanism unconfirmed.",
            "evidence": "no precedent above the similarity threshold; requires plant investigation",
        })
    return chain


def draft_capa(cluster: dict, k: int = 3) -> dict:
    hits = search(_cluster_query(cluster), k=k, component=cluster["component"])
    strong = [h for h in hits if h["score"] >= PRECEDENT_MIN_SCORE]
    precedent = strong[0] if strong else None

    cost = _breakdown_costs().get(cluster["component"], 20000)
    # Value at risk across the whole lot, not just the units that already
    # failed — the point of acting on a batch is the ones that haven't yet.
    at_risk = cluster["cohort_size"] - cluster["failures"]
    projected_savings = at_risk * cost

    return {
        # Slice off the "BATCH-" prefix rather than taking a fixed tail, which
        # left a stray leading dash ("...--Q3-WP").
        "capa_id": (f"CAPA-DRAFT-{dt.date.today():%Y%m%d}-"
                     f"{cluster['batch_id'].removeprefix('BATCH-')}"),
        "status": "draft",
        "cluster_key": cluster["cluster_key"],
        "component": cluster["component"],
        "batch_id": cluster["batch_id"],
        "plant": cluster["plant"],
        "evidence": {
            "failures": cluster["failures"], "cohort_size": cluster["cohort_size"],
            "failure_rate": cluster["failure_rate"], "baseline_rate": cluster["baseline_rate"],
            "lift": cluster["lift"], "p_value": cluster["p_value"],
            "q_value": cluster["q_value"], "survives_fdr": cluster["survives_fdr"],
        },
        "five_why": build_five_why(cluster, precedent),
        "cited_capa_ids": [h["capa_id"] for h in strong],
        "recommended_corrective": (
            precedent["corrective_action"] if precedent
            else f"Quarantine and inspect the remaining {at_risk} units in {cluster['batch_id']}."
        ),
        "recommended_preventive": (
            precedent["preventive_action"] if precedent
            else "Add a lot-level acceptance test for this characteristic."
        ),
        "units_at_risk": at_risk,
        "projected_savings_inr": projected_savings,
        "confidence": "high" if (precedent and cluster["survives_fdr"]) else "needs_review",
    }
