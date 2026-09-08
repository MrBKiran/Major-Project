from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from utils.db import get_db
from utils.models import CAPARecord

router = APIRouter()


@router.get("/capa")
async def list_capa(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CAPARecord).order_by(CAPARecord.created_at.desc()))
    return result.scalars().all()


@router.get("/capa/{capa_id}")
async def get_capa(capa_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CAPARecord).where(CAPARecord.id == capa_id))
    rec = result.scalar_one_or_none()
    if not rec:
        from fastapi import HTTPException
        raise HTTPException(404, "CAPA record not found")
    return rec


@router.post("/generate")
async def generate_rca(vin: str, component: str, db: AsyncSession = Depends(get_db)):
    """Trigger RCA/CAPA generation for a component defect cluster."""
    import uuid
    from datetime import datetime
    rec = CAPARecord(
        id=str(uuid.uuid4()),
        component=component,
        model="Bolero",
        batch_id="BATCH_2024_Q1",
        five_why=[
            {"why": "Why did the water pump fail?", "answer": "Seal degraded prematurely"},
            {"why": "Why did the seal degrade?", "answer": "Coolant quality below spec"},
            {"why": "Why was coolant below spec?", "answer": "Wrong coolant used at service"},
            {"why": "Why was wrong coolant used?", "answer": "Parts catalog error at plant"},
            {"why": "Why was there a catalog error?", "answer": "Database migration data loss"},
        ],
        corrective_action="Replace water pump seals across affected batch. Issue service advisory.",
        preventive_action="Update parts catalog. Add coolant quality sensor to production checklist.",
        status="OPEN",
        created_at=datetime.utcnow(),
    )
    db.add(rec)
    await db.commit()
    return {"capa_id": rec.id, "status": "CREATED"}
