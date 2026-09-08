import uuid
from fastapi import APIRouter, BackgroundTasks, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from utils.db import get_db
from utils.models import AgentRun
from agents.master_agent import run_master_agent

router = APIRouter()


class AgentTrigger(BaseModel):
    vin: str
    demo_mode: bool = True


@router.post("/trigger")
async def trigger_agent(body: AgentTrigger, bg: BackgroundTasks, db: AsyncSession = Depends(get_db)):
    run_id = str(uuid.uuid4())
    run = AgentRun(id=run_id, vin=body.vin, status="RUNNING", plan=[])
    db.add(run)
    await db.commit()
    bg.add_task(run_master_agent, run_id, body.vin, body.demo_mode)
    return {"run_id": run_id, "status": "RUNNING"}


@router.get("/runs/{run_id}")
async def get_run(run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentRun).where(AgentRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        from fastapi import HTTPException
        raise HTTPException(404, "Run not found")
    return run


@router.get("/runs")
async def list_runs(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(AgentRun).order_by(AgentRun.started_at.desc()).limit(20))
    return result.scalars().all()
