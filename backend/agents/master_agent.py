"""
AutoSaarthi – LangGraph Master Agent
PLAN → DISPATCH → OBSERVE → RE-PLAN → CLOSE
"""
import asyncio
from typing import TypedDict, Annotated, List
from langgraph.graph import StateGraph, END
from langchain_groq import ChatGroq
from utils.config import settings
from api.websocket_manager import ws_manager


class AgentState(TypedDict):
    run_id: str
    vin: str
    plan: List[str]
    current_step: int
    results: dict
    replanning_needed: bool
    closed: bool
    demo_mode: bool


def build_master_graph():
    llm = ChatGroq(api_key=settings.GROQ_API_KEY, model="llama-3.1-8b-instant")

    def plan_node(state: AgentState) -> AgentState:
        state["plan"] = [
            "DataAnalysisAgent",
            "DiagnosisAgent",
            "CustomerEngagementAgent",
            "SchedulingAgent",
            "FeedbackAgent",
        ]
        state["current_step"] = 0
        state["results"] = {}
        state["replanning_needed"] = False
        return state

    def dispatch_node(state: AgentState) -> AgentState:
        step = state["current_step"]
        if step >= len(state["plan"]):
            state["closed"] = True
            return state
        agent_name = state["plan"][step]
        # Call the appropriate worker
        result = _call_worker(agent_name, state)
        state["results"][agent_name] = result
        state["current_step"] += 1
        return state

    def _call_worker(agent_name: str, state: AgentState) -> dict:
        """Dispatch to the appropriate worker agent."""
        if agent_name == "DataAnalysisAgent":
            from agents.workers.data_analysis import run as run_da
            return run_da(state["vin"], state["demo_mode"])
        elif agent_name == "DiagnosisAgent":
            from agents.workers.diagnosis import run as run_diag
            return run_diag(state["vin"], state["results"].get("DataAnalysisAgent", {}))
        elif agent_name == "CustomerEngagementAgent":
            from agents.workers.customer_engagement import run as run_ce
            return run_ce(state["vin"], state["results"].get("DiagnosisAgent", {}))
        elif agent_name == "SchedulingAgent":
            from agents.workers.scheduling import run as run_sched
            return run_sched(state["vin"], state["results"].get("CustomerEngagementAgent", {}))
        elif agent_name == "FeedbackAgent":
            from agents.workers.feedback import run as run_fb
            return run_fb(state["vin"])
        return {"status": "skipped"}

    def observe_node(state: AgentState) -> AgentState:
        last_agent = state["plan"][state["current_step"] - 1] if state["current_step"] > 0 else None
        if last_agent:
            result = state["results"].get(last_agent, {})
            if result.get("status") == "DECLINED":
                state["replanning_needed"] = True
        return state

    def replan_node(state: AgentState) -> AgentState:
        state["replanning_needed"] = False
        # Skip scheduling if customer declined
        state["plan"] = [p for p in state["plan"] if p != "SchedulingAgent"]
        return state

    def close_node(state: AgentState) -> AgentState:
        state["closed"] = True
        return state

    def should_replan(state: AgentState) -> str:
        if state.get("closed"):
            return "close"
        if state.get("replanning_needed"):
            return "replan"
        if state["current_step"] >= len(state["plan"]):
            return "close"
        return "dispatch"

    graph = StateGraph(AgentState)
    graph.add_node("plan", plan_node)
    graph.add_node("dispatch", dispatch_node)
    graph.add_node("observe", observe_node)
    graph.add_node("replan", replan_node)
    graph.add_node("close", close_node)

    graph.set_entry_point("plan")
    graph.add_edge("plan", "dispatch")
    graph.add_edge("dispatch", "observe")
    graph.add_conditional_edges("observe", should_replan, {
        "dispatch": "dispatch",
        "replan": "replan",
        "close": "close",
    })
    graph.add_edge("replan", "dispatch")
    graph.add_edge("close", END)

    return graph.compile()


master_graph = build_master_graph()


async def run_master_agent(run_id: str, vin: str, demo_mode: bool = True):
    state: AgentState = {
        "run_id": run_id,
        "vin": vin,
        "plan": [],
        "current_step": 0,
        "results": {},
        "replanning_needed": False,
        "closed": False,
        "demo_mode": demo_mode,
    }
    try:
        final_state = master_graph.invoke(state)
        await ws_manager.broadcast("agent_complete", {
            "run_id": run_id,
            "vin": vin,
            "results": final_state["results"],
        })
    except Exception as e:
        await ws_manager.broadcast("agent_error", {"run_id": run_id, "error": str(e)})
