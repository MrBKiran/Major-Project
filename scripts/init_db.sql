-- AutoSaarthi Database Initialization
-- Runs automatically when PostgreSQL container starts for the first time

-- Enable TimescaleDB extension if available
CREATE EXTENSION IF NOT EXISTS timescaledb CASCADE;

-- Seed: Service Centers
INSERT INTO service_centers (id, name, location, capacity_per_day, skills)
VALUES
  ('SC001', 'Mahindra Service – Koramangala', 'Bengaluru', 12, '["Water Pump", "Engine", "Electrical"]'),
  ('SC002', 'Mahindra Service – Whitefield', 'Bengaluru', 10, '["Brakes", "Suspension", "AC"]'),
  ('SC003', 'Mahindra Service – Jayanagar', 'Bengaluru', 8, '["General", "Oil Change", "Tyres"]')
ON CONFLICT (id) DO NOTHING;

-- Seed: Customers
INSERT INTO customers (id, name, phone, language, consent_given)
VALUES
  ('CUST001', 'Ramesh Kumar', '+91-9876543210', 'hi', true),
  ('CUST002', 'Priya Singh', '+91-9876543211', 'en', true),
  ('CUST003', 'Arjun Mehta', '+91-9876543212', 'hi', true)
ON CONFLICT (id) DO NOTHING;

-- Seed: Vehicles
INSERT INTO vehicles (vin, model, variant, manufacture_year, batch_id, plant_code, owner_id, drive_state)
VALUES
  ('MH12AB1001', 'Bolero', 'B4', 2022, 'BATCH_Q1_2024', 'NASIK', 'CUST001', 'DRIVING'),
  ('MH12AB1002', 'Scorpio', 'S11', 2023, 'BATCH_Q2_2024', 'PUNE', 'CUST002', 'PARKED'),
  ('MH12AB1003', 'Thar', 'LX AT', 2023, 'BATCH_Q1_2024', 'NASIK', 'CUST003', 'PARKED')
ON CONFLICT (vin) DO NOTHING;

-- Make telemetry hypertable if TimescaleDB available
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    PERFORM create_hypertable('telemetry', 'timestamp', if_not_exists => TRUE);
  END IF;
EXCEPTION WHEN OTHERS THEN
  -- TimescaleDB not available, skip
  NULL;
END $$;
