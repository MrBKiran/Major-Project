"""The mobile app's push registration: where this account's phones can be
reached. Delivery and the rules about devices are in app/push.py."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field

from app import push
from app.auth.audit import record_principal
from app.auth.deps import current_principal
from app.auth.principal import Principal
from app.db.session import engine

router = APIRouter(prefix="/api/me/devices", tags=["devices"])


class DeviceRequest(BaseModel):
    token: str = Field(max_length=200, pattern=push.TOKEN_PATTERN)
    platform: Literal["android", "ios"]


@router.post("")
async def register_device(req: DeviceRequest,
                          principal: Principal = Depends(current_principal)) -> dict:
    with engine.begin() as conn:
        device_id = push.register(conn, principal.user_id, req.token, req.platform)
    record_principal(principal, "push.device_registered", subject=str(device_id),
                     platform=req.platform)
    return {"id": device_id, "platform": req.platform}


@router.get("")
async def list_devices(principal: Principal = Depends(current_principal)) -> dict:
    with engine.connect() as conn:
        rows = push.devices_for(conn, principal.user_id)
    # A hint, not the token: whoever holds the token can push to that phone.
    return {"devices": [{"id": d.id, "platform": d.platform, "hint": push.hint(d.token),
                         "created_at": d.created_at.isoformat(),
                         "last_seen_at": d.last_seen_at.isoformat()} for d in rows]}


@router.delete("/{device_id}", status_code=204)
async def forget_device(device_id: int,
                        principal: Principal = Depends(current_principal)) -> Response:
    with engine.begin() as conn:
        forgotten = push.forget(conn, principal.user_id, device_id)
    if not forgotten:
        raise HTTPException(404, "unknown device")
    record_principal(principal, "push.device_forgotten", subject=str(device_id))
    return Response(status_code=204)
