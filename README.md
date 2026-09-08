# AutoSaarthi — Agentic AI Automotive Platform

> Predicts vehicle failures before breakdown · Talks to drivers · Schedules proactive service · Detects unsafe agent behaviour · Feeds recurring defects back to manufacturing through RCA and CAPA.

---

## Architecture

```
Vehicle Simulator → MQTT (Mosquitto) → FastAPI Backend
                                          ↓
                              LangGraph Master Agent
                                ↙  ↙  ↘  ↘  ↘
                    Data    Diagnosis  Customer  Scheduling  Feedback
                  Analysis                              ↘
                                               Manufacturing Quality
                                                (RCA/CAPA)
                         UEBA wraps every agent tool call
                              ↓
                    React Dashboards (Fleet · In-Car · Agents · UEBA · Plant)
```

## Quick Start

### Prerequisites
- Docker & Docker Compose
- Node.js 20+
- Python 3.11+

### 1. Environment setup
```bash
cp .env.example .env
# Edit .env and add your GROQ_API_KEY and GEMINI_API_KEY
```

### 2. Start infrastructure
```bash
docker-compose up -d mosquitto postgres
```

### 3. Build ML models (one-time)
```bash
cd backend
pip install -r requirements.txt
cd ..
python scripts/build_models.py
```

### 4. Start backend
```bash
cd backend
uvicorn app.main:app --reload --port 8000
```

### 5. Start frontend
```bash
cd frontend
npm install
npm run dev
```

### 6. Start simulator
```bash
cd simulator
pip install paho-mqtt numpy
python simulator.py
```

### Or — run everything with Docker
```bash
docker-compose up --build
```

Open: http://localhost:5173

---

## Project Structure

```
autosaarthi/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI entry point
│   │   ├── config.py            # Settings
│   │   ├── simulators.py        # Demo telemetry generator
│   │   ├── api/                 # REST + WebSocket routes
│   │   │   ├── vehicles.py
│   │   │   ├── telemetry.py
│   │   │   ├── predictions.py
│   │   │   ├── appointments.py
│   │   │   ├── agents.py
│   │   │   ├── ueba.py
│   │   │   ├── rca.py
│   │   │   └── ws.py
│   │   ├── agents/
│   │   │   └── master_agent.py  # LangGraph PLAN→DISPATCH→OBSERVE→REPLAN→CLOSE
│   │   ├── ml/
│   │   │   └── models.py        # M1 Health, M2 Failure, M3 Demand, M4 Anomaly
│   │   ├── ueba/
│   │   │   └── engine.py        # Policy RBAC + IsolationForest + audit chain
│   │   ├── rca_capa/
│   │   │   └── pipeline.py      # Cluster → 5-Why → Ishikawa → CAPA
│   │   ├── mqtt/
│   │   │   └── client.py        # MQTT subscriber
│   │   └── db/
│   │       ├── schema.sql       # Full DB schema with TimescaleDB
│   │       └── database.py      # SQLAlchemy async engine
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   └── src/
│       ├── App.tsx              # Router + nav
│       ├── pages/
│       │   ├── Dashboard.tsx    # Fleet overview
│       │   ├── VehicleConsole.tsx  # In-car + voice
│       │   ├── AgentView.tsx    # Master agent runs
│       │   ├── UEBAConsole.tsx  # Security + red team
│       │   ├── PlantDashboard.tsx  # RCA/CAPA
│       │   └── Appointments.tsx    # Service booking
│       ├── hooks/
│       │   └── useTelemetry.ts  # WebSocket hook
│       └── lib/
│           └── api.ts           # Axios API client
├── simulator/
│   └── simulator.py             # MQTT publisher (10 vehicles)
├── scripts/
│   ├── build_models.py          # Train & save ML models
│   └── seed_demo.py             # Seed demo vehicles to DB
├── tests/
│   ├── test_ml.py
│   ├── test_ueba.py
│   ├── test_rca.py
│   └── test_simulator.py
├── docker/
│   └── mosquitto.conf
├── docker-compose.yml
└── README.md
```

---

## ML Models

| Model | Algorithm | Purpose |
|-------|-----------|---------|
| M1 Health Classifier | LightGBM | 4-class vehicle health (Excellent/Good/Needs Service/Critical) |
| M2 Failure Predictor | XGBoost | Component failure probability + days to failure + P1/P2/P3 severity |
| M3 Demand Forecaster | SARIMAX/Prophet | 14-day service centre demand forecast |
| M4 Anomaly Detector | IsolationForest | Vehicle telemetry + agent behaviour anomaly scoring |

---

## Agent Architecture (LangGraph)

```
PLAN → DISPATCH → [UEBA check] → WORKER → OBSERVE → RE-PLAN or CLOSE
```

Workers: Data Analysis · Diagnosis · Customer Engagement · Scheduling · Feedback · Manufacturing Quality

---

## UEBA Security

- **Layer A**: RBAC policy matrix (instant ALLOW/BLOCK)
- **Layer B**: IsolationForest behaviour scoring
- **Layer C**: LLM sequence judge
- **Audit**: Hash-chain tamper-evident log

Red Team: Try `scheduling_agent → telemetry.read` → BLOCK expected.

---

## Demo Scenario

1. Open Fleet Dashboard — 10 vehicles streaming live telemetry
2. Note Bolero MH12AB1001 coolant rising (hero scenario)
3. Go to In-Car Console — set DRIVING mode
4. Voice: "Haan, book kar do" → slot held, no touch controls
5. Switch to PARKED → confirm slot
6. Go to Agents → Run Agent for MH12AB1001 → see PLAN/DISPATCH/OBSERVE
7. Go to UEBA → Red Team: scheduling_agent → telemetry.read → BLOCK + audit chain
8. Go to Plant → Run RCA Pipeline → see 5-Why + CAPA draft

---

## Running Tests

```bash
cd backend
pip install pytest pytest-asyncio
pytest ../tests/ -v
```

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `GROQ_API_KEY` | Groq API key for LLM |
| `GEMINI_API_KEY` | Gemini fallback API key |
| `DATABASE_URL` | PostgreSQL connection string |
| `MQTT_HOST` | MQTT broker hostname |
| `MQTT_PORT` | MQTT broker port (default 1883) |
| `DEMO_MODE` | Enable deterministic demo fixtures |

---

Built for: IEEE / Hackathon submission  
Team size: 3  
Timeline: 15 days  
Stack: Python 3.11 · FastAPI · LangGraph · React 18 · TypeScript · Tailwind · LightGBM · XGBoost · MQTT
