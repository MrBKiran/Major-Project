-- Enable TimescaleDB
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TABLE IF NOT EXISTS vehicles (
    id SERIAL PRIMARY KEY,
    vin VARCHAR(20) UNIQUE NOT NULL,
    model VARCHAR(100),
    variant VARCHAR(100),
    manufacture_year INT,
    batch_id VARCHAR(50),
    plant_id VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    vehicle_vin VARCHAR(20) REFERENCES vehicles(vin),
    name VARCHAR(200),
    phone VARCHAR(20),
    language VARCHAR(10) DEFAULT 'hi',
    preferences JSONB DEFAULT '{}',
    consent BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS telemetry (
    time TIMESTAMPTZ NOT NULL,
    vin VARCHAR(20) NOT NULL,
    speed FLOAT,
    rpm FLOAT,
    coolant_temp FLOAT,
    oil_pressure FLOAT,
    battery_voltage FLOAT,
    fuel_level FLOAT,
    engine_load FLOAT,
    dtc JSONB DEFAULT '[]',
    raw JSONB DEFAULT '{}'
);
SELECT create_hypertable('telemetry', 'time', if_not_exists => TRUE);

CREATE TABLE IF NOT EXISTS predictions (
    id SERIAL PRIMARY KEY,
    vin VARCHAR(20) REFERENCES vehicles(vin),
    predicted_at TIMESTAMPTZ DEFAULT NOW(),
    health_class VARCHAR(20),
    health_probabilities JSONB,
    component VARCHAR(100),
    failure_probability FLOAT,
    days_to_failure INT,
    severity VARCHAR(5),
    shap_values JSONB,
    anomaly_score FLOAT
);

CREATE TABLE IF NOT EXISTS service_centers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200),
    location VARCHAR(300),
    capacity_per_day INT DEFAULT 10,
    skills JSONB DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS capacity_slots (
    id SERIAL PRIMARY KEY,
    center_id INT REFERENCES service_centers(id),
    slot_date DATE NOT NULL,
    slot_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'open',
    vehicle_vin VARCHAR(20),
    held_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS appointments (
    id SERIAL PRIMARY KEY,
    vin VARCHAR(20) REFERENCES vehicles(vin),
    slot_id INT REFERENCES capacity_slots(id),
    status VARCHAR(30) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY,
    appointment_id INT REFERENCES appointments(id),
    csat INT,
    nps INT,
    comments TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS capa_records (
    id SERIAL PRIMARY KEY,
    record_id VARCHAR(50) UNIQUE,
    component VARCHAR(100),
    batch_id VARCHAR(50),
    description TEXT,
    root_cause TEXT,
    corrective_action TEXT,
    preventive_action TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS rca_reports (
    id SERIAL PRIMARY KEY,
    vin_cluster JSONB,
    component VARCHAR(100),
    five_why JSONB,
    ishikawa JSONB,
    pdf_path TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(50) UNIQUE,
    vin VARCHAR(20),
    plan JSONB,
    status VARCHAR(30) DEFAULT 'running',
    outcome JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_audit (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(50),
    agent VARCHAR(100),
    tool VARCHAR(100),
    arguments_hash TEXT,
    decision VARCHAR(20),
    risk_score FLOAT,
    reason TEXT,
    prev_hash TEXT,
    row_hash TEXT,
    ts TIMESTAMPTZ DEFAULT NOW()
);

-- Seed service centers
INSERT INTO service_centers (name, location, capacity_per_day, skills)
VALUES
('AutoSaarthi Bengaluru Central', 'MG Road, Bengaluru', 15, '["engine","cooling","electrical","tires"]'),
('AutoSaarthi Whitefield', 'Whitefield, Bengaluru', 12, '["engine","brake","suspension"]'),
('AutoSaarthi Mysuru', 'Mysuru Road, Mysuru', 8, '["engine","cooling","electrical"]')
ON CONFLICT DO NOTHING;
