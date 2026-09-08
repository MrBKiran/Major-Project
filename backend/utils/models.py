"""
AutoSaarthi – SQLAlchemy ORM Models
Mirrors Section 15 of the blueprint (17 tables)
"""
from datetime import datetime
from sqlalchemy import (
    Column, String, Float, Integer, Boolean,
    DateTime, JSON, ForeignKey, Text, Enum
)
from sqlalchemy.orm import relationship
from utils.db import Base
import enum


class DriveState(str, enum.Enum):
    PARKED = "PARKED"
    DRIVING = "DRIVING"
    STOPPED_BRIEF = "STOPPED_BRIEF"
    IGNITION_OFF = "IGNITION_OFF"


class HealthLabel(str, enum.Enum):
    EXCELLENT = "Excellent"
    GOOD = "Good"
    NEEDS_SERVICE = "Needs Service"
    CRITICAL = "Critical"


class SeverityLevel(str, enum.Enum):
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class Vehicle(Base):
    __tablename__ = "vehicles"
    vin = Column(String, primary_key=True)
    model = Column(String, nullable=False)
    variant = Column(String)
    manufacture_year = Column(Integer)
    batch_id = Column(String)
    plant_code = Column(String)
    owner_id = Column(String, ForeignKey("customers.id"))
    drive_state = Column(Enum(DriveState), default=DriveState.IGNITION_OFF)
    created_at = Column(DateTime, default=datetime.utcnow)

    telemetry = relationship("Telemetry", back_populates="vehicle")
    predictions = relationship("Prediction", back_populates="vehicle")


class Customer(Base):
    __tablename__ = "customers"
    id = Column(String, primary_key=True)
    name = Column(String, nullable=False)
    phone = Column(String)
    language = Column(String, default="hi")
    preferences = Column(JSON, default={})
    consent_given = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Telemetry(Base):
    __tablename__ = "telemetry"
    id = Column(Integer, primary_key=True, autoincrement=True)
    vin = Column(String, ForeignKey("vehicles.vin"))
    timestamp = Column(DateTime, default=datetime.utcnow)
    speed = Column(Float)
    rpm = Column(Float)
    coolant_temp = Column(Float)
    oil_pressure = Column(Float)
    battery_voltage = Column(Float)
    fuel_level = Column(Float)
    dtc_codes = Column(JSON, default=[])
    raw = Column(JSON, default={})

    vehicle = relationship("Vehicle", back_populates="telemetry")


class Prediction(Base):
    __tablename__ = "predictions"
    id = Column(Integer, primary_key=True, autoincrement=True)
    vin = Column(String, ForeignKey("vehicles.vin"))
    timestamp = Column(DateTime, default=datetime.utcnow)
    health_label = Column(Enum(HealthLabel))
    health_probabilities = Column(JSON)
    component = Column(String)
    failure_probability = Column(Float)
    days_to_failure = Column(Integer)
    severity = Column(Enum(SeverityLevel))
    shap_top_features = Column(JSON)

    vehicle = relationship("Vehicle", back_populates="predictions")


class ServiceCenter(Base):
    __tablename__ = "service_centers"
    id = Column(String, primary_key=True)
    name = Column(String)
    location = Column(String)
    capacity_per_day = Column(Integer, default=10)
    skills = Column(JSON, default=[])


class CapacitySlot(Base):
    __tablename__ = "capacity_slots"
    id = Column(Integer, primary_key=True, autoincrement=True)
    center_id = Column(String, ForeignKey("service_centers.id"))
    slot_date = Column(DateTime)
    total_slots = Column(Integer)
    booked_slots = Column(Integer, default=0)
    held_slots = Column(Integer, default=0)


class Appointment(Base):
    __tablename__ = "appointments"
    id = Column(String, primary_key=True)
    vin = Column(String, ForeignKey("vehicles.vin"))
    center_id = Column(String, ForeignKey("service_centers.id"))
    slot_id = Column(Integer, ForeignKey("capacity_slots.id"))
    status = Column(String, default="PENDING")
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class Feedback(Base):
    __tablename__ = "feedback"
    id = Column(Integer, primary_key=True, autoincrement=True)
    appointment_id = Column(String, ForeignKey("appointments.id"))
    csat = Column(Integer)
    nps = Column(Integer)
    comment = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)


class AgentRun(Base):
    __tablename__ = "agent_runs"
    id = Column(String, primary_key=True)
    vin = Column(String)
    status = Column(String, default="RUNNING")
    plan = Column(JSON)
    result = Column(JSON)
    started_at = Column(DateTime, default=datetime.utcnow)
    ended_at = Column(DateTime)


class AgentAudit(Base):
    __tablename__ = "agent_audit"
    id = Column(Integer, primary_key=True, autoincrement=True)
    run_id = Column(String, ForeignKey("agent_runs.id"))
    timestamp = Column(DateTime, default=datetime.utcnow)
    agent = Column(String)
    tool = Column(String)
    args_hash = Column(String)
    decision = Column(String)
    risk_score = Column(Float)
    reasons = Column(JSON)
    prev_hash = Column(String)
    row_hash = Column(String)


class CAPARecord(Base):
    __tablename__ = "capa_records"
    id = Column(String, primary_key=True)
    component = Column(String)
    model = Column(String)
    batch_id = Column(String)
    five_why = Column(JSON)
    corrective_action = Column(Text)
    preventive_action = Column(Text)
    status = Column(String, default="OPEN")
    created_at = Column(DateTime, default=datetime.utcnow)
