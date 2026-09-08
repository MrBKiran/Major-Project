from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
import random

router = APIRouter()

DEMO_VEHICLES = [
    {"vin": "MH12AB1001", "model": "Bolero", "variant": "B6", "manufacture_year": 2021,
     "batch_id": "BATCH-MH-2023-Q4", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Ramesh Kumar", "phone": "+91-98765-43210", "language": "hi"}},
    {"vin": "MH12AB1002", "model": "Thar", "variant": "LX", "manufacture_year": 2022,
     "batch_id": "BATCH-MH-2023-Q4", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Priya Sharma", "phone": "+91-98765-43211", "language": "en"}},
    {"vin": "KA03CD2001", "model": "Scorpio-N", "variant": "Z8", "manufacture_year": 2023,
     "batch_id": "BATCH-KA-2023-Q3", "plant_id": "PLANT-NASHIK-01",
     "customer": {"name": "Suresh Reddy", "phone": "+91-98765-43212", "language": "kn"}},
    {"vin": "MH04EF3001", "model": "XUV700", "variant": "AX7", "manufacture_year": 2023,
     "batch_id": "BATCH-MH-2024-Q1", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Anjali Menon", "phone": "+91-98765-43213", "language": "en"}},
    {"vin": "TN09GH4001", "model": "Bolero", "variant": "B4", "manufacture_year": 2020,
     "batch_id": "BATCH-MH-2023-Q4", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Murugan Pandi", "phone": "+91-98765-43214", "language": "ta"}},
    {"vin": "DL01IJ5001", "model": "XUV300", "variant": "W8", "manufacture_year": 2022,
     "batch_id": "BATCH-KA-2023-Q3", "plant_id": "PLANT-NASHIK-01",
     "customer": {"name": "Rohit Gupta", "phone": "+91-98765-43215", "language": "hi"}},
    {"vin": "MH02KL6001", "model": "Bolero", "variant": "B6", "manufacture_year": 2021,
     "batch_id": "BATCH-MH-2023-Q4", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Meena Joshi", "phone": "+91-98765-43216", "language": "hi"}},
    {"vin": "GJ01MN7001", "model": "Thar", "variant": "AX", "manufacture_year": 2022,
     "batch_id": "BATCH-MH-2024-Q1", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Kiran Patel", "phone": "+91-98765-43217", "language": "gu"}},
    {"vin": "RJ14OP8001", "model": "Scorpio", "variant": "S5", "manufacture_year": 2020,
     "batch_id": "BATCH-KA-2023-Q3", "plant_id": "PLANT-NASHIK-01",
     "customer": {"name": "Vikram Singh", "phone": "+91-98765-43218", "language": "hi"}},
    {"vin": "WB06QR9001", "model": "XUV700", "variant": "MX", "manufacture_year": 2023,
     "batch_id": "BATCH-MH-2024-Q1", "plant_id": "PLANT-PUNE-01",
     "customer": {"name": "Debashish Roy", "phone": "+91-98765-43219", "language": "bn"}},
]

@router.get("/")
async def list_vehicles():
    return DEMO_VEHICLES

@router.get("/{vin}")
async def get_vehicle(vin: str):
    v = next((v for v in DEMO_VEHICLES if v["vin"] == vin), None)
    if not v:
        raise HTTPException(404, f"Vehicle {vin} not found")
    return v

@router.get("/{vin}/status")
async def vehicle_status(vin: str):
    states = ["PARKED", "DRIVING", "STOPPED_BRIEF", "IGNITION_OFF"]
    return {"vin": vin, "drive_state": random.choice(states)}
