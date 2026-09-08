from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from utils.db import get_db
from utils.models import Vehicle

router = APIRouter()


@router.get("/")
async def list_vehicles(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Vehicle))
    vehicles = result.scalars().all()
    return [{"vin": v.vin, "model": v.model, "drive_state": v.drive_state} for v in vehicles]


@router.get("/{vin}")
async def get_vehicle(vin: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Vehicle).where(Vehicle.vin == vin))
    vehicle = result.scalar_one_or_none()
    if not vehicle:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@router.put("/{vin}/drive_state")
async def update_drive_state(vin: str, state: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Vehicle).where(Vehicle.vin == vin))
    vehicle = result.scalar_one_or_none()
    if vehicle:
        vehicle.drive_state = state
        await db.commit()
    return {"vin": vin, "drive_state": state}
