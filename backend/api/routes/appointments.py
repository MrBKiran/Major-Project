import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from utils.db import get_db
from utils.models import Appointment

router = APIRouter()


class AppointmentCreate(BaseModel):
    vin: str
    center_id: str
    slot_id: int
    notes: str = ""


@router.post("/")
async def create_appointment(body: AppointmentCreate, db: AsyncSession = Depends(get_db)):
    appt = Appointment(
        id=str(uuid.uuid4()),
        vin=body.vin,
        center_id=body.center_id,
        slot_id=body.slot_id,
        notes=body.notes,
        status="CONFIRMED",
    )
    db.add(appt)
    await db.commit()
    return {"id": appt.id, "status": appt.status}


@router.get("/{vin}")
async def get_appointments(vin: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Appointment).where(Appointment.vin == vin))
    return result.scalars().all()


@router.put("/{appt_id}/cancel")
async def cancel_appointment(appt_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Appointment).where(Appointment.id == appt_id))
    appt = result.scalar_one_or_none()
    if appt:
        appt.status = "CANCELLED"
        await db.commit()
    return {"id": appt_id, "status": "CANCELLED"}
