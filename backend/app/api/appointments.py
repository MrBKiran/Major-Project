from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import uuid

router = APIRouter()
appointments: list[dict] = []

DEMO_SLOTS = [
    {"slot_id": "SLOT-001", "center": "AutoSaarthi Bengaluru Central", "date": "2024-06-15", "time": "09:00", "status": "open"},
    {"slot_id": "SLOT-002", "center": "AutoSaarthi Bengaluru Central", "date": "2024-06-15", "time": "11:00", "status": "open"},
    {"slot_id": "SLOT-003", "center": "AutoSaarthi Whitefield", "date": "2024-06-16", "time": "10:00", "status": "open"},
]

class BookingRequest(BaseModel):
    vin: str
    slot_id: str
    notes: Optional[str] = ""

@router.get("/slots")
async def list_slots():
    return DEMO_SLOTS

@router.post("/book")
async def book_appointment(req: BookingRequest):
    appt = {"appointment_id": str(uuid.uuid4())[:8], "vin": req.vin,
            "slot_id": req.slot_id, "notes": req.notes, "status": "confirmed"}
    appointments.append(appt)
    return appt

@router.get("/")
async def list_appointments():
    return appointments
