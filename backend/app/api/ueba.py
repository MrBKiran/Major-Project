from fastapi import APIRouter
from pydantic import BaseModel
from app.ueba.engine import evaluate_call, get_audit_log, POLICY_MATRIX

router = APIRouter()

class RedTeamRequest(BaseModel):
    agent: str
    tool: str
    run_id: str = "red-team-test"

@router.post("/redteam")
async def red_team(req: RedTeamRequest):
    result = evaluate_call(req.run_id, req.agent, req.tool, {"test": True}, [1.5]*8)
    return result

@router.get("/audit")
async def audit_log(limit: int = 50):
    return get_audit_log(limit)

@router.get("/policy")
async def policy_matrix():
    return POLICY_MATRIX
