"""Car-screen routes: what a head unit may show, booking from it, and the
demo's drive-state control. Logic in app/car.py."""

from __future__ import annotations

import asyncio
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import car
from app.api_common import require_vin
from app.auth.audit import record_principal
from app.auth.deps import requires
from app.auth.principal import Principal
from app.config import settings

router = APIRouter(prefix="/api/car", tags=["car"])


@router.get("/{vin}/screen")
async def car_screen(vin: str, principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    await require_vin(principal, vin, "car.screen")
    result = await asyncio.to_thread(car.screen, vin)
    # Offered only when /simulate would accept it, so no page shows a control
    # the server then refuses.
    result["controls"] = {"drive_state": settings.demo_mode and principal.can("redteam:run")}
    return result


class BookRequest(BaseModel):
    center_id: str = Field(min_length=1, max_length=16)
    slot_start: str = Field(min_length=10, max_length=40)


@router.post("/{vin}/book")
async def car_book(vin: str, req: BookRequest,
                   principal: Principal = Depends(requires("vehicle:read"))) -> dict:
    await require_vin(principal, vin, "car.book")
    result = await car.book(vin, req.center_id, req.slot_start)
    record_principal(principal, "car.book", subject=vin, appointment_id=result.get("appointment_id"))
    return result


class SimulateRequest(BaseModel):
    drive_state: Literal["PARKED", "IGNITION_OFF", "STOPPED_BRIEF", "DRIVING"]


@router.post("/{vin}/simulate")
async def car_simulate(vin: str, req: SimulateRequest,
                       principal: Principal = Depends(requires("redteam:run"))) -> dict:
    """Demo control. Restricted to the red-team permission and demo mode: a
    caller who could set PARKED at speed could unlock exactly what G6 forbids."""
    if not settings.demo_mode:
        raise HTTPException(404, "not available outside demo mode")
    await require_vin(principal, vin, "car.simulate")
    record_principal(principal, "car.simulate", subject=vin, drive_state=req.drive_state)
    return await asyncio.to_thread(car.simulate, vin, req.drive_state)
