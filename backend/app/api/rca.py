from fastapi import APIRouter
from app.rca_capa.pipeline import run_rca_pipeline, capa_store

router = APIRouter()

DEMO_FAILURES = [
    {"vin": "MH12AB1001", "component": "water_pump", "batch_id": "BATCH-MH-2023-Q4"},
    {"vin": "TN09GH4001", "component": "water_pump", "batch_id": "BATCH-MH-2023-Q4"},
    {"vin": "MH02KL6001", "component": "water_pump", "batch_id": "BATCH-MH-2023-Q4"},
    {"vin": "MH12AB1002", "component": "brake_pad",  "batch_id": "BATCH-MH-2023-Q4"},
    {"vin": "DL01IJ5001", "component": "brake_pad",  "batch_id": "BATCH-KA-2023-Q3"},
    {"vin": "RJ14OP8001", "component": "brake_pad",  "batch_id": "BATCH-KA-2023-Q3"},
    {"vin": "KA03CD2001", "component": "brake_pad",  "batch_id": "BATCH-KA-2023-Q3"},
]

@router.get("/capa")
async def list_capa():
    return capa_store

@router.post("/run")
async def run_rca():
    reports = run_rca_pipeline(DEMO_FAILURES)
    return {"reports_generated": len(reports), "reports": reports}
