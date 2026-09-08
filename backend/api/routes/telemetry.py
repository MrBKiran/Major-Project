from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from utils.db import get_db
from utils.models import Telemetry

router = APIRouter()


@router.get("/{vin}")
async def get_telemetry(
    vin: str,
    limit: int = Query(50, le=500),
    db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(Telemetry)
        .where(Telemetry.vin == vin)
        .order_by(desc(Telemetry.timestamp))
        .limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "timestamp": r.timestamp,
            "speed": r.speed,
            "rpm": r.rpm,
            "coolant_temp": r.coolant_temp,
            "oil_pressure": r.oil_pressure,
            "battery_voltage": r.battery_voltage,
            "fuel_level": r.fuel_level,
            "dtc_codes": r.dtc_codes,
        }
        for r in rows
    ]


@router.get("/latest/all")
async def get_all_latest(db: AsyncSession = Depends(get_db)):
    """Return latest telemetry row per vehicle for dashboard overview."""
    from sqlalchemy import func
    subq = (
        select(Telemetry.vin, func.max(Telemetry.timestamp).label("max_ts"))
        .group_by(Telemetry.vin)
        .subquery()
    )
    stmt = select(Telemetry).join(
        subq, (Telemetry.vin == subq.c.vin) & (Telemetry.timestamp == subq.c.max_ts)
    )
    result = await db.execute(stmt)
    rows = result.scalars().all()
    return [
        {
            "vin": r.vin,
            "timestamp": r.timestamp,
            "speed": r.speed,
            "rpm": r.rpm,
            "coolant_temp": r.coolant_temp,
            "oil_pressure": r.oil_pressure,
            "battery_voltage": r.battery_voltage,
            "fuel_level": r.fuel_level,
        }
        for r in rows
    ]
