from fastapi import APIRouter
from pydantic import BaseModel
from app.agents.master_agent import run_master_agent
from app.simulators import generate_demo_telemetry

router = APIRouter()
run_history: list[dict] = []

class AgentRunRequest(BaseModel):
    vin: str
    demo_mode: bool = True

@router.post("/run")
async def trigger_agent(req: AgentRunRequest):
    telem = generate_demo_telemetry(req.vin)
    result = await run_master_agent(req.vin, telem)
    run_history.append(result)
    return result

@router.get("/runs")
async def list_runs():
    return run_history[-20:]
