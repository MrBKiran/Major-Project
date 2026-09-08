"""
CAPA/RCA corpus — generation and retrieval.

Retrieval is TF-IDF + cosine similarity rather than sentence embeddings. For a
corpus this size (~150 short, highly domain-specific documents that share a
controlled vocabulary — "impeller", "seal", "weep", "NBR", "FKM"), lexical
overlap IS the signal, and TF-IDF has two practical advantages here: it needs
no multi-gigabyte model download on a memory-constrained machine, and it can
name the exact terms that drove a match, which is worth more in an RCA audit
trail than an opaque similarity score.

`search()` is the seam — swapping in embeddings later means reimplementing one
function, not touching the agent.
"""

from __future__ import annotations

import datetime as dt
import random
import re
from functools import lru_cache
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

ROOT = Path(__file__).resolve().parents[3]
CORPUS_DIR = ROOT / "data" / "capa_corpus"

# The historical CAPA the water-pump cluster should retrieve. Its id is named in
# vehicles.yaml's ground_truth_cluster as `matching_capa`.
ANCHOR_CAPA_ID = "CAPA-2023-0871"

_COMPONENTS = ["water_pump", "brake_pads", "battery", "fuel_injector", "oil_pump",
               "alternator", "clutch_assembly", "radiator", "turbocharger", "wheel_bearing"]
_PLANTS = ["Nashik", "Chakan", "Haridwar", "Pithampur"]
_STATUSES = ["closed", "closed", "closed", "open", "monitoring"]

_DEFECT_MODES = {
    "water_pump": ["impeller seal weep", "bearing play beyond limit", "impeller vane erosion"],
    "brake_pads": ["premature friction material wear", "uneven pad taper", "backing plate corrosion"],
    "battery": ["plate sulphation", "terminal corrosion", "low reserve capacity"],
    "fuel_injector": ["nozzle carbon fouling", "spray pattern deviation", "injector body leak"],
    "oil_pump": ["relief valve wear", "pickup screen blockage", "rotor clearance drift"],
    "alternator": ["regulator failure", "slip ring wear", "diode bridge failure"],
    "clutch_assembly": ["facing wear", "pressure plate distortion", "release bearing noise"],
    "radiator": ["core tube leak", "fin corrosion", "end tank crimp seep"],
    "turbocharger": ["shaft bearing wear", "wastegate sticking", "oil seal leak"],
    "wheel_bearing": ["raceway spalling", "seal ingress", "preload loss"],
}
_CAUSE_TEMPLATES = [
    "Supplier changed the {part} compound without revalidation; the substitute hardens above {temp}°C.",
    "Assembly torque at the {station} station drifted outside the control limit for {weeks} weeks.",
    "Incoming inspection sampling missed a {part} dimensional deviation from a single supplier lot.",
    "Tooling wear at the {station} station produced an out-of-tolerance {part} press fit.",
    "A revised {part} specification was released to production before the validation build completed.",
]
_CORRECTIVE = [
    "Quarantine and inspect all affected units in the batch.",
    "Recall-inspect the affected lot and replace the component under warranty.",
    "Rework the affected units at the regional service network.",
    "Contain stock at the plant and sort by supplier lot number.",
]
_PREVENTIVE = [
    "Revise the supplier specification and add a lot-level acceptance test.",
    "Add an end-of-line {test} test at the {station} station.",
    "Introduce SPC monitoring on the {station} torque with automatic line stop.",
    "Add a dimensional gate at incoming inspection for the {part}.",
]
_PARTS = ["seal", "bearing", "gasket", "housing", "shaft", "O-ring", "bushing"]
_STATIONS = ["sub-assembly", "final-assembly", "press-fit", "leak-test", "engine-dress"]
_TESTS = ["pressure-decay", "flow", "vibration-signature", "thermal-cycle"]


def _anchor_document() -> dict:
    """The water-pump seal CAPA the demo's defect cluster must find."""
    return {
        "capa_id": ANCHOR_CAPA_ID,
        "component": "water_pump",
        "plant": "Nashik",
        "batch_id": "BATCH-2023-Q1-WP",
        "opened": "2023-03-14",
        "status": "closed",
        "defect_mode": "Impeller shaft seal weep leading to progressive coolant flow loss and overheat",
        "root_cause": (
            "Supplier substituted the impeller shaft seal compound from FKM to a lower-grade "
            "nitrile (NBR) for cost reasons. The NBR compound hardens above 105°C, losing "
            "conformity at the shaft interface and allowing coolant to weep past the bearing. "
            "Progressive flow loss then presents as a climbing coolant temperature on sustained "
            "highway load before the pump fails outright."
        ),
        "corrective_action": (
            "Recall-inspect the affected lot; replace pump assembly and flush the cooling "
            "system on any unit showing weep at the bearing housing."
        ),
        "preventive_action": (
            "Mandate FKM seal compound in the supplier specification and add an end-of-line "
            "pressure-decay test at 110°C to the water-pump station."
        ),
        "five_why": [
            "Why did the engine overheat? Coolant flow dropped below the required rate.",
            "Why did coolant flow drop? The water pump impeller lost sealing at the shaft.",
            "Why did the seal fail? The seal compound hardened and lost conformity in service.",
            "Why did the compound harden? NBR was substituted for FKM and degrades above 105°C.",
            "Why was NBR substituted? A supplier cost-down change was accepted without "
            "high-temperature revalidation.",
        ],
    }


def _generate_document(i: int, rng: random.Random) -> dict:
    component = rng.choice(_COMPONENTS)
    plant = rng.choice(_PLANTS)
    year = rng.choice([2021, 2022, 2023, 2024])
    part, station, test = rng.choice(_PARTS), rng.choice(_STATIONS), rng.choice(_TESTS)
    cause = rng.choice(_CAUSE_TEMPLATES).format(
        part=part, station=station, temp=rng.choice([95, 105, 110, 120]), weeks=rng.randint(2, 9)
    )
    mode = rng.choice(_DEFECT_MODES[component])
    return {
        "capa_id": f"CAPA-{year}-{1000 + i:04d}",
        "component": component,
        "plant": plant,
        "batch_id": f"BATCH-{year}-Q{rng.randint(1, 4)}-STD",
        "opened": f"{year}-{rng.randint(1, 12):02d}-{rng.randint(1, 28):02d}",
        "status": rng.choice(_STATUSES),
        "defect_mode": f"{component.replace('_', ' ').title()} — {mode}",
        "root_cause": cause,
        "corrective_action": rng.choice(_CORRECTIVE),
        "preventive_action": rng.choice(_PREVENTIVE).format(test=test, station=station, part=part),
        "five_why": [
            f"Why did the {component.replace('_', ' ')} fail? Observed {mode}.",
            f"Why did that occur? Deviation traced to the {station} station.",
            f"Why was the deviation present? {cause}",
            "Why was it not detected? The existing control plan had no gate for this characteristic.",
            "Why was there no gate? The FMEA did not rank this failure mode above the action threshold.",
        ],
    }


def as_markdown(doc: dict) -> str:
    whys = "\n".join(f"{i + 1}. {w}" for i, w in enumerate(doc["five_why"]))
    return (
        f"# {doc['capa_id']}\n\n"
        f"- **Component:** {doc['component']}\n"
        f"- **Plant:** {doc['plant']}\n"
        f"- **Batch:** {doc['batch_id']}\n"
        f"- **Opened:** {doc['opened']}\n"
        f"- **Status:** {doc['status']}\n\n"
        f"## Defect mode\n{doc['defect_mode']}\n\n"
        f"## Root cause\n{doc['root_cause']}\n\n"
        f"## 5-Why\n{whys}\n\n"
        f"## Corrective action\n{doc['corrective_action']}\n\n"
        f"## Preventive action\n{doc['preventive_action']}\n"
    )


def generate_corpus(n: int = 150, seed: int = 77) -> int:
    rng = random.Random(seed)
    CORPUS_DIR.mkdir(parents=True, exist_ok=True)
    for old in CORPUS_DIR.glob("CAPA-*.md"):
        old.unlink()

    docs = [_anchor_document()] + [_generate_document(i, rng) for i in range(n - 1)]
    for doc in docs:
        (CORPUS_DIR / f"{doc['capa_id']}.md").write_text(as_markdown(doc), encoding="utf-8")
    _load_corpus.cache_clear()
    return len(docs)


# ── retrieval ───────────────────────────────────────────────────────────────

def _parse(md: str) -> dict:
    def section(name: str) -> str:
        m = re.search(rf"## {name}\n(.+?)(?=\n## |\Z)", md, re.S)
        return m.group(1).strip() if m else ""

    def field(name: str) -> str:
        m = re.search(rf"\*\*{name}:\*\* (.+)", md)
        return m.group(1).strip() if m else ""

    return {
        "capa_id": re.search(r"^# (\S+)", md).group(1),
        "component": field("Component"), "plant": field("Plant"),
        "batch_id": field("Batch"), "status": field("Status"),
        "defect_mode": section("Defect mode"), "root_cause": section("Root cause"),
        "five_why": [re.sub(r"^\d+\.\s*", "", ln) for ln in section("5-Why").splitlines() if ln.strip()],
        "corrective_action": section("Corrective action"),
        "preventive_action": section("Preventive action"),
    }


@lru_cache(maxsize=1)
def _load_corpus() -> tuple[list[dict], TfidfVectorizer, object]:
    paths = sorted(CORPUS_DIR.glob("CAPA-*.md"))
    if not paths:
        raise FileNotFoundError(
            f"No CAPA corpus in {CORPUS_DIR} — run `python -m app.rca.corpus` to generate it."
        )
    docs = [_parse(p.read_text(encoding="utf-8")) for p in paths]
    blobs = [
        f"{d['component']} {d['plant']} {d['defect_mode']} {d['root_cause']} "
        f"{' '.join(d['five_why'])} {d['corrective_action']} {d['preventive_action']}"
        for d in docs
    ]
    # 1-2 grams: "seal compound" and "pressure decay" carry meaning their
    # individual words don't.
    vectorizer = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), min_df=1)
    matrix = vectorizer.fit_transform(blobs)
    return docs, vectorizer, matrix


def search(query: str, k: int = 5, component: str | None = None) -> list[dict]:
    docs, vectorizer, matrix = _load_corpus()
    sims = cosine_similarity(vectorizer.transform([query]), matrix)[0]

    order = sims.argsort()[::-1]
    hits = []
    feature_names = vectorizer.get_feature_names_out()
    q_vec = vectorizer.transform([query])
    q_terms = {feature_names[i] for i in q_vec.nonzero()[1]}

    for idx in order:
        if len(hits) >= k:
            break
        doc = docs[idx]
        if component and doc["component"] != component:
            continue
        if sims[idx] <= 0.0:
            continue
        d_terms = {feature_names[i] for i in matrix[idx].nonzero()[1]}
        hits.append({
            **doc,
            "score": round(float(sims[idx]), 4),
            # The terms that actually drove the match — an RCA reviewer can see
            # why this document was retrieved instead of taking it on faith.
            "matched_terms": sorted(q_terms & d_terms)[:8],
        })
    return hits


if __name__ == "__main__":
    n = generate_corpus()
    print(f"[corpus] {n} CAPA/RCA documents written to {CORPUS_DIR}")
