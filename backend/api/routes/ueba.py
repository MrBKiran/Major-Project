from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from utils.db import get_db
from utils.models import AgentAudit

router = APIRouter()


@router.get("/audit")
async def get_audit_log(limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(AgentAudit).order_by(desc(AgentAudit.timestamp)).limit(limit)
    )
    rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "run_id": r.run_id,
            "timestamp": r.timestamp,
            "agent": r.agent,
            "tool": r.tool,
            "decision": r.decision,
            "risk_score": r.risk_score,
            "reasons": r.reasons,
            "row_hash": r.row_hash,
        }
        for r in rows
    ]


@router.post("/red-team/{run_id}")
async def red_team_inject(run_id: str, db: AsyncSession = Depends(get_db)):
    """Inject a simulated unauthorized tool-call event for demo purposes."""
    fake_event = AgentAudit(
        run_id=run_id,
        agent="SchedulingAgent",
        tool="telemetry.read_window",
        args_hash="sha256:demo_hash",
        decision="BLOCK",
        risk_score=0.92,
        reasons=["Tool not in agent's allowed set", "Policy violation: cross-domain access"],
        prev_hash="0000",
        row_hash="demo_block_hash",
    )
    db.add(fake_event)
    await db.commit()
    return {"message": "Red-team BLOCK event injected", "agent": fake_event.agent, "decision": "BLOCK"}
