# AutoSaarthi

**Techathon 6.0 · Challenge III (Automotive — Hero + M&M)**
Autonomous Predictive Maintenance & Proactive Service Scheduling with a
Manufacturing Feedback Loop.

A Master Agent orchestrates six Worker Agents over a live vehicle telemetry
stream: it predicts component failures, calls the owner with a persuasive
voice agent, books the service slot, follows up for feedback, and feeds
RCA/CAPA insights back to the plant — with every agent action policed by a
UEBA security layer.

> Full build plan, architecture rationale and 3-week schedule: [`../PROJECT_PLAN.md`](../PROJECT_PLAN.md)

---

## Status

| Component | State |
|---|---|
| Fleet screenplay (`simulator/vehicles.yaml`) | ✅ 10 vehicles, 5 degradation models, scripted edge cases |
| Tool registry (`backend/app/tools/`) | ✅ 30 tools registered, typed, UEBA-gated |
| UEBA Layer A — policy matrix | ✅ 7 agents, allow/deny, rate limits, data scope |
| UEBA Layer B — behavioural baseline | ✅ cold-start heuristics; IsolationForest pending training data |
| UEBA Layer C — sequence + injection | ✅ plan deviation + prompt-injection screening |
| Tamper-evident audit log | ✅ SHA-256 hash chain + `/api/ueba/verify-chain` — cross-process safe (`filelock`, see `app/ueba/audit.py`) |
| Red Team harness | ✅ 4 attacks, real calls through the real guard |
| DB schema + seed (10 vehicles, 11 centres, DTC catalog, CAPA ground truth) | ✅ `backend/app/db/` |
| MQTT → Timescale ingest | ✅ `backend/app/ingest.py` — verified live against a real simulator burst |
| Historical parc + service records | ✅ `backend/app/db/history_seed.py` — 510 vehicles, 1169 records across 10 batches |
| ML M1 — health classifier | ✅ RandomForest, 69.2% acc / 0.686 macro-F1 on synthetic holdout — the known weak point, see `ml/artifacts/m1_metrics.json` |
| ML M2 — component + wear-progress | ✅ XGBoost, **97.1%** component acc, 0.070 progress MAE (≈1.3 days) — **9/10 fleet components** match `vehicles.yaml`, control vehicle correctly silent |
| ML M3 — demand forecaster | ✅ SARIMAX(1,1,1)(1,1,1,7) + bottom-up predicted-failure load; overload flags + same-city redistribution |
| ML M4 — vehicle anomaly | ⚠️ built but **not demo-ready** — recall at noise level; drive-cycle load confounds deviation-from-nominal. See `ml/artifacts/m4_metrics.json`. The same IsolationForest *does* work agent-side in `ueba/baseline.py` |
| LangGraph Master + Data Analysis + Diagnosis | ✅ `backend/app/graph/` |
| Customer Engagement + Scheduling agents | ✅ persuasion policy in `config/strategies.yaml`; objection handling re-ranks slots and books for real |
| Feedback agent | ✅ own run + declared plan (G3-authorized); CSAT + write-back closes the loop |
| Mfg Quality / RCA-CAPA | ✅ Fisher exact + Benjamini-Hochberg FDR clustering, TF-IDF CAPA retrieval, grounded 5-Why with citations — rediscovers the hidden ground-truth cluster |
| LLM router | ✅ `backend/app/llm/router.py` — Groq → Gemini → DEMO_MODE fixtures; runs with no API keys |
| Red team (all 5 attacks) | ✅ 5/5 blocking correctly; hash chain verifies |
| **Multi-tenant RBAC (humans/orgs)** | ✅ `config/access_policy.yaml` + `backend/app/auth/` — 11 roles across 5 org kinds, row scoping + PII redaction, **18 isolation tests** |
| Auth | ✅ JWT bearer, PBKDF2-HMAC-SHA256 passwords, membership re-checked per request so revocation is immediate |
| Principal access log | ✅ `backend/app/auth/audit.py` — who read/changed what, incl. **denied** attempts; queryable by subject ("who touched this VIN") |
| Rate limiting | ✅ `backend/app/auth/ratelimit.py` — login brute-force (per account + per IP, failures only) and per-principal API budget |
| Schema migrations | ✅ Alembic (`backend/migrations/`) — Timescale hypertable objects excluded from autogenerate |
| Pagination | ✅ offset+limit, hard-capped at 200, on every list endpoint (`app/api_common.py`) |
| Async agent-run queue | ✅ `backend/app/jobs.py` — `POST /runs/trigger` returns 202+job id (or `wait:true` for the demo); Postgres-backed, survives client disconnect, orphaned jobs marked `interrupted` on restart |
| Structured logging + correlation ids | ✅ `backend/app/observability.py` — every request gets an id threaded into JSON logs, response headers, and (soon) agent-run attribution |
| Health checks | ✅ `/api/health/live` (dependency-free), `/api/health/ready` (503 if DB/models down), `/api/health` (human detail, no internals leaked) |
| CORS / secrets | ✅ configurable via `CORS_ORIGINS` / `JWT_SECRET` env vars, not hardcoded — see `.env.example` |
| Global error handling | ✅ unhandled exceptions logged with request id, generic body returned — no internals leak to the client |
| JWT revocation | ✅ `users.token_version`, checked every request alongside the existing membership recheck — `POST /api/auth/logout` (self, all sessions) and `POST /api/auth/users/{id}/revoke-sessions` (admin-forced); **8 tests** in `test_auth_revocation.py` |
| OpenAPI docs | ✅ app description, every endpoint tagged (`ueba`/`redteam`/`tools` were missing) — `/docs` is now a complete, navigable surface |
| REST API for Slides 1–4 | ✅ `backend/app/api_fleet.py` — fleet, vehicle detail, forecast, clusters, CAPA draft, run trigger. Every route permission-guarded and scope-filtered |
| Deterministic demo reset | ✅ `backend/scripts/reset_demo.py` — restores the exact state the slide numbers were computed from |
| Voice pipeline | ⬜ use the **browser** Web Speech API + `speechSynthesis` (PROJECT_PLAN §7), not piper-tts — no install, no Windows blocker |
| Frontend | ⬜ scope to **five screenshot-grade screens**, one per slide — the deliverable is a 5-slide PPT, not a product |

---

## Quickstart

```bash
python -m venv .venv && source .venv/bin/activate    # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                  # add GROQ_API_KEY

docker compose up -d                                  # postgres+timescale, mosquitto

cd backend
uvicorn app.main:app --reload --port 8000
# → http://localhost:8000/docs
```

### Two policy layers, both enforced

They answer different questions and neither substitutes for the other:

| File | Governs | Question it answers |
|---|---|---|
| `config/agent_policy.yaml` | **Agents** | May the Scheduling Agent *call* `telemetry.read_window`? |
| `config/access_policy.yaml` | **People / orgs** | May this dealer group *see* VIN MH12AB1001 at all? |

They compose. An agent run is bounded by the intersection — the agent's tool
grants **and** the triggering principal's data scope. Agent policy alone would
let one dealer point a legitimately-permissioned agent at a rival's VIN.

Row scoping lives in `app/auth/scope.py`, applied in the data layer rather than
per-endpoint, so a new route cannot forget it. Verified isolation:

| Login (password `autosaarthi`) | Scope | Sees | Owner PII |
|---|---|---|---|
| `admin@autosaarthi.io` | all | 10 | visible |
| `advisor@westernauto.example` | centres | 6 | visible |
| `advisor@southernmotors.example` | centres | 4 | visible |
| `quality@mahindra.example` | brand | 9 | **redacted** |
| `analyst@hero.example` | brand | 1 | **redacted** |
| `ramesh.pawar@example.in` | owned | 1 | redacted |

The two dealer groups sum to the whole parc with zero overlap. The OEM sees
failures across its brand and never an owner's name — which is what lets the
manufacturing feedback loop run on the real parc without handing the plant a
customer database.

```bash
cd backend && python -m pytest tests/test_tenancy.py -q
```

### Before every rehearsal and the real demo

```bash
cd backend && python scripts/reset_demo.py
```

The feedback loop is genuinely closed: a completed service is written back into
`maintenance_history`, where the defect clustering then counts it — so Slide 4's
lift figure **moves as the demo runs**. That is the loop working, not a bug, but
it means the slide numbers are only reproducible from a known starting point.
Reset, then re-run the prediction sweep.

### Verify the security layer works

```bash
cd backend && python -m pytest tests/test_ueba_redteam.py -v
```

Or hit it live — this is the Slide 5 demo, running against the real guard:

```bash
curl -X POST localhost:8000/api/redteam/run -H 'content-type: application/json' \
     -d '{"attack_id":"ATTACK-1"}'
curl localhost:8000/api/ueba/verify-chain
```

---

## The four Red Team scenarios

| # | Attack | Caught by | Result |
|---|---|---|---|
| 1 | Scheduling Agent reaches for `telemetry.read_window` | Layer A — explicit deny | **BLOCK** + quarantine |
| 2 | Data Analysis Agent enumerates all 10 VINs in 5s | A + B — `max_distinct_vins_per_run`, call rate | **BLOCK** |
| 3 | Prompt injection over the **voice** channel | A + C — cancel rate limit, injection screen | **BLOCK** |
| 4 | Feedback Agent bulk-writes records at 03:00 IST | B + C — hour-of-day, plan deviation | **FLAG** → human approval |

Scenario 1 is verbatim the example given in the problem statement.

---

## Architecture in one paragraph

Telemetry publishes to MQTT `fleet/{vin}/telemetry` — from a CSV replayer today,
from a ₹800 ELM327 OBD-II dongle in Phase 2, with **zero backend changes**.
FastAPI ingests into TimescaleDB. A LangGraph `StateGraph` runs the Master Agent
(plan → dispatch → observe → re-plan → close); Worker Agents reach every
capability through `tools/registry.invoke()`, which is the single choke point
where UEBA evaluates policy, behaviour and intent before anything executes.
Every decision is hash-chained into an append-only audit log. The React frontend
subscribes to one WebSocket event stream that drives the agent-trace graph, the
security console and the fleet dashboard.

---

## Layout

```
config/agent_policy.yaml     UEBA policy matrix — also renders as Slide 5
simulator/vehicles.yaml      the 10-vehicle screenplay; written before any code
backend/app/tools/registry.py  the choke point everything routes through
backend/app/ueba/            policy (A) · baseline (B) · sequence (C) · guard · audit
backend/tests/               red team regression suite
ml/                          notebooks, training scripts, model artifacts
```

## Design rules

1. **No agent imports another module's function directly.** Everything goes through
   `invoke(agent_id, tool, args, ctx)`. That is what makes UEBA non-bypassable.
2. **The Master Agent is deliberately weak.** It cannot book, cannot read PII,
   cannot write maintenance records. Its power is coordination. Compromising the
   orchestrator must not compromise the fleet.
3. **Irreversible tools must be in a declared plan.** `runs.write_plan` first,
   or `scheduler.confirm` is refused.
4. **Emit or it didn't happen.** If an action isn't on the event bus, the judge
   can't see it.
