"""
Defect clustering — the analysis behind the manufacturing feedback loop.

Groups historical component replacements by (component, batch, plant) and asks
one question per cohort: is this lot failing more often than the rest of the
parc, by more than chance?

Uses Fisher's exact test rather than a chi-square because the interesting
cohorts are small (a 40-vehicle batch with 5 failures), which is exactly where
chi-square's normal approximation stops being trustworthy. `lift` is the ratio
a plant engineer actually reads; the p-value is what stops them chasing noise.

Nothing here reads vehicles.yaml's `ground_truth_cluster` — that block exists
to check this module's answer, not to supply it.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from scipy.stats import fisher_exact
from sqlalchemy import text

from app.db.session import engine

# Which replaced part implies which component failed. Sourced from the
# `repair.parts` lists in simulator/vehicles.yaml.
PART_TO_COMPONENT = {
    "water_pump_assy": "water_pump", "coolant_5l": "water_pump",
    "brake_pad_set_front": "brake_pads",
    "battery_12v_65ah": "battery",
    "injector_set": "fuel_injector", "fuel_filter": "fuel_injector",
    "oil_pump": "oil_pump", "oil_5w30_4l": "oil_pump",
}


@dataclass
class DefectCluster:
    component: str
    batch_id: str
    plant: str
    cohort_size: int
    failures: int
    failure_rate: float
    baseline_rate: float
    lift: float
    p_value: float
    q_value: float = 1.0            # Benjamini-Hochberg adjusted
    survives_fdr: bool = False
    example_notes: list[str] = field(default_factory=list)

    @property
    def cluster_key(self) -> str:
        return f"{self.component} | {self.plant} | {self.batch_id}"

    def to_dict(self) -> dict:
        return {
            "cluster_key": self.cluster_key,
            "component": self.component, "batch_id": self.batch_id, "plant": self.plant,
            "cohort_size": self.cohort_size, "failures": self.failures,
            "failure_rate": round(self.failure_rate, 4),
            "baseline_rate": round(self.baseline_rate, 4),
            "lift": round(self.lift, 2), "p_value": round(self.p_value, 5),
            "q_value": round(self.q_value, 5), "survives_fdr": self.survives_fdr,
            "example_notes": self.example_notes[:3],
        }


_FAILURES_SQL = text("""
    SELECT v.batch_id, v.plant, m.components_replaced, m.technician_notes, m.vin
    FROM maintenance_history m
    JOIN vehicles v ON v.vin = m.vin
    WHERE m.components_replaced IS NOT NULL
      AND array_length(m.components_replaced, 1) > 0
      AND v.batch_id IS NOT NULL
""")

_COHORT_SQL = text("SELECT batch_id, plant, COUNT(*) FROM vehicles "
                    "WHERE batch_id IS NOT NULL GROUP BY batch_id, plant")

# Brand-restricted variants. The filter is applied to BOTH the cohorts and the
# failures, so the comparison baseline is drawn from the same brand as the
# cohort under test. That is not only a tenancy requirement — it is the correct
# analysis. Judging a Mahindra batch against a parc that includes Hero vehicles
# compares populations with different components, duty cycles and service
# intervals, and the resulting "lift" would measure the brand mix as much as
# the defect.
_FAILURES_SQL_BRANDED = text(str(_FAILURES_SQL) + " AND v.oem = ANY(:brands)")
_COHORT_SQL_BRANDED = text(
    "SELECT batch_id, plant, COUNT(*) FROM vehicles "
    "WHERE batch_id IS NOT NULL AND oem = ANY(:brands) GROUP BY batch_id, plant"
)


def _apply_fdr(clusters: list[DefectCluster], n_tests: int, alpha: float = 0.05) -> None:
    """Benjamini-Hochberg, in place.

    Every (component, batch, plant) cohort is a separate hypothesis test, and
    there are dozens — at alpha=0.05 roughly one in twenty clean cohorts will
    look significant by chance alone. Since a flagged cluster sends a plant on
    a real recall investigation, each one carries the adjusted q-value and
    whether it survives correction, so a marginal cohort isn't presented with
    the same confidence as a genuine defect.
    """
    ranked = sorted(clusters, key=lambda c: c.p_value)
    prev_q = 1.0
    for i in range(len(ranked) - 1, -1, -1):     # walk up so q stays monotone
        c = ranked[i]
        q = min(prev_q, c.p_value * n_tests / (i + 1))
        c.q_value = min(1.0, q)
        c.survives_fdr = c.q_value <= alpha
        prev_q = c.q_value


def find_clusters(component: str | None = None, min_lift: float = 2.0,
                   min_cohort_size: int = 5, max_p_value: float = 0.05,
                   brands: list[str] | None = None) -> list[dict]:
    """Significant defect cohorts.

    `brands` restricts the entire analysis to those marques. Callers serving an
    OEM principal MUST pass it: defect clusters name a competitor's failing
    batch and its failure rate, which is exactly the manufacturing data an OEM
    would most like to read about a rival.
    """
    cohort_sql = _COHORT_SQL_BRANDED if brands else _COHORT_SQL
    failures_sql = _FAILURES_SQL_BRANDED if brands else _FAILURES_SQL
    params = {"brands": brands} if brands else {}

    with engine.connect() as conn:
        cohorts = {(b, p): n for b, p, n in conn.execute(cohort_sql, params).all()}

        # vehicles that had each component replaced, per (batch, plant)
        failed_vins: dict[tuple[str, str, str], set[str]] = {}
        notes: dict[tuple[str, str, str], list[str]] = {}
        for batch_id, plant, parts, note, vin in conn.execute(failures_sql, params).all():
            for part in parts or []:
                comp = PART_TO_COMPONENT.get(part)
                if not comp or (component and comp != component):
                    continue
                key = (comp, batch_id, plant)
                failed_vins.setdefault(key, set()).add(vin)
                if note:
                    notes.setdefault(key, []).append(note)

    # fleet-wide totals per component, for the baseline each cohort is judged against
    totals_by_component: dict[str, int] = {}
    fleet_size = sum(cohorts.values())
    for (comp, _b, _p), vins in failed_vins.items():
        totals_by_component[comp] = totals_by_component.get(comp, 0) + len(vins)

    clusters: list[DefectCluster] = []
    n_tests = 0
    for (comp, batch_id, plant), vins in failed_vins.items():
        cohort_size = cohorts.get((batch_id, plant), 0)
        failures = len(vins)
        if cohort_size < min_cohort_size or failures == 0:
            continue

        # Compare this cohort against the REST of the parc, not against the
        # whole parc — leaving the cohort inside the baseline dilutes exactly
        # the signal being tested for.
        rest_size = fleet_size - cohort_size
        rest_failures = totals_by_component.get(comp, 0) - failures
        if rest_size <= 0 or rest_failures < 0:
            continue

        rate = failures / cohort_size
        baseline = rest_failures / rest_size
        if baseline <= 0:
            continue

        # Every eligible cohort is tested, and the lift/p filters are applied
        # only afterwards. Screening on lift first and then correcting over the
        # survivors would understate how many hypotheses were really examined.
        n_tests += 1
        _odds, p = fisher_exact(
            [[failures, cohort_size - failures], [rest_failures, rest_size - rest_failures]],
            alternative="greater",
        )
        clusters.append(DefectCluster(
            component=comp, batch_id=batch_id, plant=plant,
            cohort_size=cohort_size, failures=failures, failure_rate=rate,
            baseline_rate=baseline, lift=rate / baseline, p_value=float(p),
            example_notes=notes.get((comp, batch_id, plant), []),
        ))

    _apply_fdr(clusters, n_tests)

    reportable = [c for c in clusters if c.lift >= min_lift and c.p_value <= max_p_value]
    reportable.sort(key=lambda c: (not c.survives_fdr, -c.lift, c.p_value))
    return [c.to_dict() for c in reportable]
