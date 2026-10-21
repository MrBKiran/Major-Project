"""The owner's service routes for one car — what the phone's Home, Book and
Reschedule screens use. Logic in app/owner_service.py."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app import owner_service
from app.api_common import require_vin
from app.auth.audit import record_principal
from app.auth.deps import requires
from app.auth.principal import Principal

router = APIRouter(prefix="/api/vehicles", tags=["service"])


class SlotRequest(BaseModel):
    center_id: str = Field(min_length=1, max_length=16)
    slot_start: str = Field(min_length=10, max_length=40)


@router.get("/{vin}/service")
async def service_view(vin: str, principal: Principal = Depends(requires("appointment:read"))) -> dict:
    await require_vin(principal, vin, "service.view")
    return await asyncio.to_thread(owner_service.view, vin)


@router.post("/{vin}/service/book")
async def service_book(vin: str, req: SlotRequest,
                       principal: Principal = Depends(requires("appointment:write"))) -> dict:
    await require_vin(principal, vin, "service.book")
    result = await asyncio.to_thread(owner_service.book, vin, req.center_id, req.slot_start)
    record_principal(principal, "service.book", subject=vin,
                     appointment_id=result["booking"]["appointment_id"])
    return result


@router.post("/{vin}/service/reschedule")
async def service_reschedule(vin: str, req: SlotRequest,
                             principal: Principal = Depends(requires("appointment:write"))) -> dict:
    await require_vin(principal, vin, "service.reschedule")
    result = await asyncio.to_thread(owner_service.reschedule, vin, req.center_id, req.slot_start)
    record_principal(principal, "service.reschedule", subject=vin,
                     appointment_id=result["booking"]["appointment_id"])
    return result


@router.post("/{vin}/service/cancel")
async def service_cancel(vin: str, principal: Principal = Depends(requires("appointment:write"))) -> dict:
    await require_vin(principal, vin, "service.cancel")
    result = await asyncio.to_thread(owner_service.cancel, vin)
    record_principal(principal, "service.cancel", subject=vin)
    return result
