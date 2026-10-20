"""
AutoSaarthi — ORM models.

Mirrors PROJECT_PLAN.md §9 exactly. `telemetry` is promoted to a TimescaleDB
hypertable in session.py::init_db() (raw SQL — SQLAlchemy has no hypertable
concept) after `create_all()` lays down the plain table.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    BigInteger, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text,
    UniqueConstraint, event,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from app.auth.phone import normalize_phone


class Base(DeclarativeBase):
    pass


def _uuid() -> str:
    return uuid.uuid4().hex[:12]


# ═══════════════════════════════════════════════════════════════════════════
#  Tenancy — organisations, users, memberships.
#
#  Every data-bearing table below is reachable only through a scope predicate
#  derived from these three (see app/auth/scope.py). Access is a property of
#  the principal, not of the endpoint.
# ═══════════════════════════════════════════════════════════════════════════

class Organization(Base):
    __tablename__ = "organizations"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(128))
    # platform | oem | service_network | fleet_operator | customer
    kind: Mapped[str] = mapped_column(String(24))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )


class OrgBrand(Base):
    """Which vehicle brands an org is entitled to.

    For an OEM these are the marques it manufactures. For a service network
    they are the marques it is authorised to service — a multi-brand dealer
    group is normal, so this is a many-to-many rather than a column on the org.
    """

    __tablename__ = "org_brands"

    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    oem: Mapped[str] = mapped_column(String(32), primary_key=True)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    # PBKDF2-HMAC-SHA256, salted, stored as algo$iterations$salt$hash.
    # Never a plaintext or unsalted-hash column.
    password_hash: Mapped[str] = mapped_column(String(256))
    full_name: Mapped[str] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Embedded in every issued JWT as the `tv` claim and re-checked on every
    # request alongside the membership lookup that already runs there (see
    # auth/deps.py). A token whose `tv` doesn't match the current value is
    # rejected — bumping this is how "log out everywhere" / "revoke this
    # user's sessions after a password change or a lost device" works without
    # a separate session-tracking table. All-or-nothing across a user's
    # tokens by design: this system has no per-device session identity to
    # revoke individually, and adding one is not worth the complexity unless
    # a real need for single-device revocation shows up.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )


class Membership(Base):
    """A user's role inside one organisation.

    Composite PK on (user_id, org_id, role): one person can be a technician at
    one dealer and a manager at another, and requests carry which membership
    they are acting under.
    """

    __tablename__ = "memberships"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    role: Mapped[str] = mapped_column(String(48), primary_key=True)


class UserIdentity(Base):
    """One external way of proving to be a user: a Google account or a phone number.

    See app/auth/identities.py. The (provider, subject) pair is unique across the
    whole table — an identifier can belong to only one user — and `subject` is the
    provider's stable id (the Google `sub`, never the email), or the E.164 number.
    """

    __tablename__ = "user_identities"
    __table_args__ = (
        UniqueConstraint("provider", "subject", name="uq_user_identities_provider_subject"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    subject: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )
    last_used_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )


class OtpChallenge(Base):
    """One request for a phone sign-in code. See app/auth/otp.py.

    The code itself is never stored — only a keyed hash bound to the number — and a
    row is written even for numbers that belong to no one (`eligible` false), so a
    request costs and leaves the same whether or not the number is real.
    """

    __tablename__ = "otp_challenges"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    phone_e164: Mapped[str] = mapped_column(String(16), index=True)
    code_hmac: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )
    # Indexed: every request runs a housekeeping DELETE keyed on it.
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    consumed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    eligible: Mapped[bool] = mapped_column(Boolean)
    requested_ip: Mapped[str | None] = mapped_column(String(64), default=None)


class UserMfa(Base):
    """A user's TOTP second factor. See app/auth/mfa.py.

    One row per user. The secret is ENCRYPTED (Fernet) — a database dump alone must
    not let anyone generate someone's codes — and enrolment is not in force until
    `confirmed_at` is set: a row without it is a pending enrolment that changes nothing
    about how the user signs in.
    """

    __tablename__ = "user_mfa"

    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    secret_enc: Mapped[str] = mapped_column(String(255))
    confirmed_at: Mapped[dt.datetime | None] = mapped_column(
        DateTime(timezone=True), default=None
    )
    # The last 30-second step a code was accepted for. A code is valid once: anything
    # at or before this step is a replay.
    last_used_step: Mapped[int | None] = mapped_column(BigInteger, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )


class MfaRecoveryCode(Base):
    """One single-use recovery code, for a user who has lost their authenticator.

    Only a keyed hash is stored; the plaintext is shown once at enrolment.
    """

    __tablename__ = "mfa_recovery_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    code_mac: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class RefreshToken(Base):
    """One issued refresh token. See app/auth/refresh.py.

    Only a keyed hash is stored, never the token itself. `family_id` is shared
    across a rotation chain (one sign-in, however many silent refreshes after
    it); `org_id`/`role`/`amr` are copied from the session it was minted for, so
    a refresh does not have to re-derive which membership a session was acting
    under. Reusing a token already marked `used_at` — a replay of a cookie the
    legitimate client has already rotated past — is how theft is detected.
    """

    __tablename__ = "refresh_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    family_id: Mapped[str] = mapped_column(String(32), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"))
    role: Mapped[str] = mapped_column(String(48))
    amr: Mapped[str] = mapped_column(String(64))
    # "web" (httpOnly cookie only) or "mobile" (response body only). Bound at
    # issue and checked on every rotation, so a cookie's successor can never be
    # handed back in a body that page script could read.
    client: Mapped[str] = mapped_column(String(8), default="web", server_default="web")
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    issued_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)



class PushDevice(Base):
    """Where the mobile app can be reached. See app/push.py.

    One row per push token: a phone signed in by someone new moves to them, so
    a handed-down phone stops getting the previous owner's alerts. Rows are
    deleted whenever the user's sessions are ended (refresh.revoke_all_for_user)
    — signing out must also stop the notifications.
    """

    __tablename__ = "push_devices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(200), unique=True)
    platform: Mapped[str] = mapped_column(String(8))
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )
    last_seen_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )

class RetiredMembership(Base):
    """A membership moved or removed when a role was retired from the policy.

    Kept so the change is both auditable ("who lost what, and why") and
    reversible: a role dropped from access_policy.yaml but still present in
    `memberships` is an account in an undefined state, so those rows have to be
    migrated — and a migration that destroys access data with no way back is one
    nobody should have to run. Deliberately no foreign keys: this is a
    historical record and must outlive whatever it describes.
    """

    __tablename__ = "retired_memberships"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(32), index=True)
    org_id: Mapped[str] = mapped_column(String(32))
    role: Mapped[str] = mapped_column(String(48))          # the retired role
    replaced_by: Mapped[str | None] = mapped_column(String(48), default=None)
    # rehomed: the row's role was changed in place. removed: the row was deleted
    # (no replacement exists, or the user already held the replacement).
    action: Mapped[str] = mapped_column(String(12))
    deactivated_user: Mapped[bool] = mapped_column(Boolean, default=False)
    reason: Mapped[str] = mapped_column(String(240))
    retired_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: dt.datetime.now(dt.timezone.utc)
    )


class FleetRoster(Base):
    """VINs belonging to a fleet_operator org."""

    __tablename__ = "fleet_roster"

    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), primary_key=True)
    vin: Mapped[str] = mapped_column(String(17), primary_key=True)


class AgentJob(Base):
    """An asynchronously-executed agent run. See app/jobs.py."""

    __tablename__ = "agent_jobs"

    id: Mapped[str] = mapped_column(String(24), primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))
    vin: Mapped[str | None] = mapped_column(String(17), index=True, default=None)
    # Who asked for it. A job outlives the request, so attribution has to be
    # stored rather than inferred from the caller later.
    principal_id: Mapped[str | None] = mapped_column(String(32), index=True, default=None)
    org_id: Mapped[str | None] = mapped_column(String(32), default=None)
    # queued | running | succeeded | failed | interrupted
    status: Mapped[str] = mapped_column(String(16), index=True, default="queued")
    params: Mapped[dict | None] = mapped_column(JSONB, default=None)
    result: Mapped[dict | None] = mapped_column(JSONB, default=None)
    error: Mapped[str | None] = mapped_column(Text, default=None)
    # Links the job back to the HTTP request that created it.
    request_id: Mapped[str | None] = mapped_column(String(32), default=None)
    created_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class AccessAudit(Base):
    """Who read or changed what. See app/auth/audit.py for why this is separate
    from the agent audit chain and why it is not hash-chained."""

    __tablename__ = "access_audit"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
    action: Mapped[str] = mapped_column(String(48), index=True)
    principal_id: Mapped[str | None] = mapped_column(String(32), index=True, default=None)
    org_id: Mapped[str | None] = mapped_column(String(32), default=None)
    role: Mapped[str | None] = mapped_column(String(48), default=None)
    # VIN, CAPA id, agent id — indexed because "who accessed this vehicle" is
    # the query this table exists to answer.
    subject: Mapped[str | None] = mapped_column(String(64), index=True, default=None)
    outcome: Mapped[str] = mapped_column(String(16), default="allowed")
    detail: Mapped[dict | None] = mapped_column(JSONB, default=None)


class Vehicle(Base):
    __tablename__ = "vehicles"

    vin: Mapped[str] = mapped_column(String(17), primary_key=True)
    model: Mapped[str] = mapped_column(String(64))
    variant: Mapped[str | None] = mapped_column(String(64), default=None)
    oem: Mapped[str | None] = mapped_column(String(32), default=None)
    mfg_date: Mapped[dt.date | None] = mapped_column(Date, default=None)
    batch_id: Mapped[str | None] = mapped_column(String(64), default=None)
    plant: Mapped[str | None] = mapped_column(String(64), default=None)
    owner_id: Mapped[str | None] = mapped_column(ForeignKey("customers.id"), default=None)
    odometer: Mapped[int] = mapped_column(Integer, default=0)
    city: Mapped[str | None] = mapped_column(String(64), default=None)
    drive_cycle: Mapped[str | None] = mapped_column(String(32), default=None)


class Customer(Base):
    __tablename__ = "customers"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    # Links an owner record to a login, so a customer principal can be scoped
    # to their own vehicles. Nullable: most of the parc has no app account.
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), default=None)
    name: Mapped[str] = mapped_column(String(128))
    phone: Mapped[str | None] = mapped_column(String(32), default=None)
    # `phone` as E.164, or NULL if it is not a number that can receive an SMS.
    # Derived — never set by hand: the listeners below keep it in step with
    # `phone`. Phone sign-in looks owners up by this column, indexed, rather than
    # normalising every row on every request.
    phone_e164: Mapped[str | None] = mapped_column(String(16), default=None, index=True)
    email: Mapped[str | None] = mapped_column(String(128), default=None)
    language: Mapped[str] = mapped_column(String(16), default="english")
    pref_time_window: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)
    pref_day_preference: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)
    pref_center_id: Mapped[str | None] = mapped_column(String(16), default=None)
    consent_voice: Mapped[bool] = mapped_column(Boolean, default=True)
    consent_push: Mapped[bool] = mapped_column(Boolean, default=True)


@event.listens_for(Customer, "before_insert")
@event.listens_for(Customer, "before_update")
def _sync_phone_e164(mapper, connection, customer: Customer) -> None:
    # Only ORM writes pass through here; a raw INSERT/UPDATE of `phone` leaves
    # phone_e164 stale, and the rest of the code treats phone_e164 as the truth.
    customer.phone_e164 = normalize_phone(customer.phone)


class Telemetry(Base):
    """TimescaleDB hypertable — see init_db(). PK is (vin, ts), not id."""

    __tablename__ = "telemetry"

    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), primary_key=True)
    vin: Mapped[str] = mapped_column(String(17), primary_key=True)
    engine_rpm: Mapped[float | None] = mapped_column(Float, default=None)
    coolant_temp: Mapped[float | None] = mapped_column(Float, default=None)
    lub_oil_pressure: Mapped[float | None] = mapped_column(Float, default=None)
    lub_oil_temp: Mapped[float | None] = mapped_column(Float, default=None)
    fuel_pressure: Mapped[float | None] = mapped_column(Float, default=None)
    battery_voltage: Mapped[float | None] = mapped_column(Float, default=None)
    tyre_pressure: Mapped[float | None] = mapped_column(Float, default=None)
    brake_fluid_pct: Mapped[float | None] = mapped_column(Float, default=None)
    speed: Mapped[float | None] = mapped_column(Float, default=None)
    ambient_temp: Mapped[float | None] = mapped_column(Float, default=None)
    throttle_position: Mapped[float | None] = mapped_column(Float, default=None)
    intake_air_temp: Mapped[float | None] = mapped_column(Float, default=None)
    maf_rate: Mapped[float | None] = mapped_column(Float, default=None)
    engine_load: Mapped[float | None] = mapped_column(Float, default=None)
    intake_manifold_pressure: Mapped[float | None] = mapped_column(Float, default=None)
    drive_state: Mapped[str | None] = mapped_column(String(16), default=None)
    dtc_codes: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)


class MaintenanceHistory(Base):
    __tablename__ = "maintenance_history"

    # 32, not 16: ids are built as MH-{vin}-{n}, and a 17-char VIN needs 23.
    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    vin: Mapped[str] = mapped_column(ForeignKey("vehicles.vin"))
    date: Mapped[dt.date] = mapped_column(Date)
    service_type: Mapped[str] = mapped_column(String(64))
    components_replaced: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)
    cost: Mapped[float | None] = mapped_column(Float, default=None)
    center_id: Mapped[str | None] = mapped_column(String(16), default=None)
    technician_notes: Mapped[str | None] = mapped_column(Text, default=None)
    km_at_service: Mapped[int | None] = mapped_column(Integer, default=None)


class DtcCatalog(Base):
    __tablename__ = "dtc_catalog"

    code: Mapped[str] = mapped_column(String(8), primary_key=True)
    description: Mapped[str] = mapped_column(Text)
    component: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(4))
    typical_causes: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)


class Prediction(Base):
    __tablename__ = "predictions"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    vin: Mapped[str] = mapped_column(ForeignKey("vehicles.vin"))
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)
    component: Mapped[str] = mapped_column(String(32))
    failure_prob: Mapped[float] = mapped_column(Float)
    days_to_failure: Mapped[float | None] = mapped_column(Float, default=None)
    severity: Mapped[str | None] = mapped_column(String(4), default=None)
    model_version: Mapped[str] = mapped_column(String(32))
    shap_top: Mapped[dict | None] = mapped_column(JSONB, default=None)


class ServiceCenter(Base):
    __tablename__ = "service_centers"

    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    # The dealer group operating this centre. Scope for service_network orgs
    # resolves through this column.
    org_id: Mapped[str | None] = mapped_column(ForeignKey("organizations.id"), default=None)
    name: Mapped[str] = mapped_column(String(128))
    city: Mapped[str] = mapped_column(String(64))
    lat: Mapped[float | None] = mapped_column(Float, default=None)
    lng: Mapped[float | None] = mapped_column(Float, default=None)
    bays: Mapped[int] = mapped_column(Integer, default=4)
    daily_capacity: Mapped[int] = mapped_column(Integer, default=20)
    skills: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)


class CapacitySlot(Base):
    __tablename__ = "capacity_slots"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    center_id: Mapped[str] = mapped_column(ForeignKey("service_centers.id"))
    slot_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    slot_end: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(8), default="open")  # open|held|booked


class ServiceDemandDaily(Base):
    """Historical daily job count per centre — the series M3 forecasts.

    Kept as a daily aggregate rather than one row per visit: the forecaster
    only ever consumes the count, and materialising ~50k individual periodic
    services to re-derive it would add nothing but rows.
    """

    __tablename__ = "service_demand_daily"

    center_id: Mapped[str] = mapped_column(ForeignKey("service_centers.id"), primary_key=True)
    date: Mapped[dt.date] = mapped_column(Date, primary_key=True)
    jobs: Mapped[int] = mapped_column(Integer)


class Appointment(Base):
    __tablename__ = "appointments"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    vin: Mapped[str] = mapped_column(ForeignKey("vehicles.vin"))
    center_id: Mapped[str] = mapped_column(ForeignKey("service_centers.id"))
    slot_start: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(16), default="held")
    created_by_agent: Mapped[str | None] = mapped_column(String(32), default=None)
    run_id: Mapped[str | None] = mapped_column(String(32), default=None)


class ServiceJob(Base):
    __tablename__ = "service_jobs"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    appointment_id: Mapped[str] = mapped_column(ForeignKey("appointments.id"))
    status: Mapped[str] = mapped_column(String(16), default="scheduled")
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    parts_used: Mapped[list[str] | None] = mapped_column(ARRAY(String), default=None)
    cost: Mapped[float | None] = mapped_column(Float, default=None)


class Feedback(Base):
    __tablename__ = "feedback"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    appointment_id: Mapped[str] = mapped_column(ForeignKey("appointments.id"))
    csat: Mapped[int] = mapped_column(Integer)
    nps: Mapped[int | None] = mapped_column(Integer, default=None)
    verbatim: Mapped[str | None] = mapped_column(Text, default=None)
    ts: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)


class CapaRecord(Base):
    __tablename__ = "capa_records"

    capa_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    defect_mode: Mapped[str] = mapped_column(Text)
    component: Mapped[str] = mapped_column(String(32))
    batch_id: Mapped[str | None] = mapped_column(String(64), default=None)
    plant: Mapped[str | None] = mapped_column(String(64), default=None)
    root_cause: Mapped[str | None] = mapped_column(Text, default=None)
    corrective_action: Mapped[str | None] = mapped_column(Text, default=None)
    preventive_action: Mapped[str | None] = mapped_column(Text, default=None)
    status: Mapped[str] = mapped_column(String(16), default="open")
    embedding_id: Mapped[str | None] = mapped_column(String(64), default=None)


class RcaReport(Base):
    __tablename__ = "rca_reports"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    capa_id: Mapped[str] = mapped_column(ForeignKey("capa_records.capa_id"))
    five_why: Mapped[dict | None] = mapped_column(JSONB, default=None)
    ishikawa: Mapped[dict | None] = mapped_column(JSONB, default=None)
    author: Mapped[str | None] = mapped_column(String(64), default=None)
    date: Mapped[dt.date | None] = mapped_column(Date, default=None)


class MfgInsight(Base):
    __tablename__ = "mfg_insights"

    id: Mapped[str] = mapped_column(String(16), primary_key=True, default=_uuid)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)
    cluster_key: Mapped[str] = mapped_column(String(64))
    evidence: Mapped[dict | None] = mapped_column(JSONB, default=None)
    hypothesis: Mapped[str | None] = mapped_column(Text, default=None)
    recommendation: Mapped[str | None] = mapped_column(Text, default=None)
    projected_savings: Mapped[float | None] = mapped_column(Float, default=None)
    status: Mapped[str] = mapped_column(String(16), default="draft")
    sent_to_plant_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)


class AgentRun(Base):
    __tablename__ = "agent_runs"

    run_id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    vin: Mapped[str | None] = mapped_column(String(17), default=None)
    trigger: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)
    ended_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
    outcome: Mapped[str | None] = mapped_column(String(32), default=None)
    plan: Mapped[list | None] = mapped_column(JSONB, default=None)


class ChatSession(Base):
    """One owner-facing conversation, resumable across page loads.

    The chat endpoint stays stateless per request — the caller still sends its
    plan and offered slots back — but the conversation itself has to outlive a
    closed modal, otherwise reopening the assistant greets the owner from
    scratch about a problem they already discussed. `run_id` is the same id the
    UEBA audit chain uses, so a stored conversation and its tool calls can be
    lined up after the fact without a second correlation key.
    """

    __tablename__ = "chat_sessions"

    run_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    vin: Mapped[str] = mapped_column(String(17), index=True)
    # The conversation belongs to the person, not the vehicle: two people with
    # access to the same VIN each get their own thread rather than reading each
    # other's. Resume looks up (vin, principal_id, status='open').
    principal_id: Mapped[str] = mapped_column(String(32), index=True)
    status: Mapped[str] = mapped_column(String(16), default="open", index=True)
    plan: Mapped[list | None] = mapped_column(JSONB, default=None)
    offered_slots: Mapped[list | None] = mapped_column(JSONB, default=None)
    objections_handled: Mapped[int] = mapped_column(Integer, default=0)
    booking: Mapped[dict | None] = mapped_column(JSONB, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)
    updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)


class ChatMessage(Base):
    """One turn. Ordered by `id` rather than a timestamp — several agent turns
    are written inside a single reply and would otherwise share a timestamp and
    come back shuffled."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(String(32), ForeignKey("chat_sessions.run_id"), index=True)
    role: Mapped[str] = mapped_column(String(12))              # user | agent | system
    text: Mapped[str] = mapped_column(Text)
    # Presentation/provenance metadata — which agent spoke, which strategy, and
    # whether the words came from a live model. Kept per-turn so a resumed
    # conversation renders identically to a live one instead of losing badges.
    agent_id: Mapped[str | None] = mapped_column(String(32), default=None)
    strategy: Mapped[str | None] = mapped_column(String(32), default=None)
    source: Mapped[str | None] = mapped_column(String(32), default=None)
    intent: Mapped[str | None] = mapped_column(String(16), default=None)
    intent_source: Mapped[str | None] = mapped_column(String(16), default=None)
    grounded_in: Mapped[int | None] = mapped_column(Integer, default=None)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)


class UebaBaseline(Base):
    __tablename__ = "ueba_baselines"

    agent_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    window_features: Mapped[dict | None] = mapped_column(JSONB, default=None)
    model_version: Mapped[str | None] = mapped_column(String(32), default=None)
    trained_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), default=None)
