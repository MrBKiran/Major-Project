"""
RCA/CAPA Manufacturing Loop
Cluster failures → retrieve past records → generate 5-Why → draft CAPA
"""
import uuid, json, logging
from datetime import datetime

logger = logging.getLogger("rca_capa")

# In-memory CAPA store (replace with ChromaDB + PostgreSQL in production)
capa_store: list[dict] = [
    {
        "record_id": "CAPA-2024-001",
        "component": "water_pump",
        "batch_id": "BATCH-MH-2023-Q4",
        "description": "Elevated coolant temperature across 8 vehicles from same batch",
        "root_cause": "Water pump impeller material fatigue under high-temperature cycles",
        "corrective_action": "Replace water pump on all affected vehicles",
        "preventive_action": "Switch to ceramic impeller material from Batch 2024-Q1 onward",
        "created_at": "2024-01-15"
    }
]

def cluster_failures(failures: list[dict]) -> dict:
    """Group failures by component and batch."""
    clusters: dict[str, list] = {}
    for f in failures:
        key = f"{f.get('component','unknown')}|{f.get('batch_id','unknown')}"
        clusters.setdefault(key, []).append(f)
    significant = {k: v for k, v in clusters.items() if len(v) >= 3}
    return significant

def retrieve_similar_capa(component: str) -> list[dict]:
    """Retrieve historical CAPA records for the same component."""
    return [c for c in capa_store if component.lower() in c["component"].lower()]

def generate_five_why(component: str, cluster_size: int, batch_id: str) -> list[dict]:
    return [
        {"why": 1, "question": f"Why did {cluster_size} vehicles from {batch_id} report {component} failure?",
         "answer": "Coolant temperature exceeded safe operating range repeatedly"},
        {"why": 2, "question": "Why did coolant temperature exceed safe range?",
         "answer": "Water pump output degraded below required flow rate"},
        {"why": 3, "question": "Why did water pump degrade prematurely?",
         "answer": "Impeller material showed fatigue under sustained high-rpm cycles"},
        {"why": 4, "question": "Why was impeller prone to fatigue?",
         "answer": "Material specification did not account for thermal cycling stress"},
        {"why": 5, "question": "Why was thermal cycling not in the specification?",
         "answer": "Validation tests used standard cycle, not worst-case Deccan Plateau summer scenario"},
    ]

def generate_ishikawa(component: str) -> dict:
    return {
        "effect": f"Premature {component} failure",
        "causes": {
            "Material": ["Sub-optimal alloy grade", "Supplier change Q3 2023"],
            "Method": ["Insufficient thermal cycle testing", "Standard validation protocol only"],
            "Machine": ["Assembly torque out of spec", "Incorrect seating depth"],
            "Environment": ["High ambient temperature operation", "Dusty road conditions"],
            "Measurement": ["No in-field vibration monitoring", "Temperature sensor lag"],
            "Man": ["Assembly line training gap", "QC sampling rate insufficient"],
        }
    }

def draft_capa(component: str, batch_id: str, cluster_size: int,
               five_why: list, ishikawa: dict, similar: list[dict]) -> dict:
    record_id = f"CAPA-{datetime.now().strftime('%Y')}-{str(uuid.uuid4())[:4].upper()}"
    return {
        "record_id": record_id,
        "component": component,
        "batch_id": batch_id,
        "affected_vehicles": cluster_size,
        "five_why": five_why,
        "ishikawa": ishikawa,
        "similar_past_capas": [s["record_id"] for s in similar],
        "corrective_actions": [
            f"Inspect and replace {component} on all {batch_id} vehicles proactively",
            "Notify service centres of recall-adjacent advisory",
        ],
        "preventive_actions": [
            "Update material specification to high-grade ceramic alloy",
            "Add Deccan Plateau thermal stress cycle to validation suite",
            "Increase QC sampling rate to 100% for critical components",
        ],
        "business_impact": {
            "estimated_cost_saving_inr": cluster_size * 8500,
            "breakdowns_prevented": cluster_size,
            "customer_satisfaction_impact": "+12 NPS points estimated",
        },
        "status": "DRAFT",
        "created_at": datetime.utcnow().isoformat(),
    }

def run_rca_pipeline(failures: list[dict]) -> list[dict]:
    clusters = cluster_failures(failures)
    reports = []
    for key, cluster in clusters.items():
        component, batch_id = key.split("|")
        similar = retrieve_similar_capa(component)
        five_why = generate_five_why(component, len(cluster), batch_id)
        ishikawa = generate_ishikawa(component)
        capa = draft_capa(component, batch_id, len(cluster), five_why, ishikawa, similar)
        reports.append(capa)
        capa_store.append({
            "record_id": capa["record_id"],
            "component": component,
            "batch_id": batch_id,
            "description": f"Auto-generated CAPA for {len(cluster)} failures",
            "root_cause": five_why[-1]["answer"],
            "corrective_action": "; ".join(capa["corrective_actions"]),
            "preventive_action": "; ".join(capa["preventive_actions"]),
            "created_at": datetime.utcnow().isoformat(),
        })
    return reports
