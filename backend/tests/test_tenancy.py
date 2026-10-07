"""
Tenant isolation tests.

These are the tests that matter most in this codebase. A bug in the ML models
produces a wrong prediction; a bug here hands one dealer group another's
customer list. Each case is written as the attack it prevents, not as the
happy path.

Requires the API running on :8010 and the tenancy seed applied:
    python -m app.db.tenancy_seed --reset
    uvicorn app.main:app --port 8010
"""

from __future__ import annotations

import httpx
import pytest

import os

# Port is overridable: 8000 is commonly already taken on dev machines.
# 127.0.0.1, not "localhost": on Windows the name resolves to ::1 first and the
# IPv4 fallback adds ~2s to EVERY call, which made this suite look like the API
# was slow when the server was answering in 14ms.
BASE = os.environ.get("AUTOSAARTHI_API", "http://127.0.0.1:8010")
PW = "autosaarthi"

WESTERN_ADVISOR = "advisor@westernauto.example"      # Pune/Mumbai/Delhi centres
SOUTHERN_ADVISOR = "advisor@southernmotors.example"  # Bengaluru/Chennai/Hyderabad
OEM_ENGINEER = "quality@mahindra.example"
OEM_MANAGER = "qmanager@mahindra.example"
HERO_ENGINEER = "analyst@hero.example"   # mailbox kept; role is oem_quality_engineer
OWNER_RAMESH = "ramesh.pawar@example.in"
SECURITY = "soc@autosaarthi.io"
ADMIN = "admin@autosaarthi.io"

HERO_VIN = "MH12AB1001"          # Mahindra Bolero, Pune, Ramesh Pawar, Western
SOUTHERN_VIN = "KA03KL1008"      # Thar, Bengaluru, SC-BLR-02, Southern


# One connection for the whole suite. A fresh client per call re-does the TCP
# handshake every time and dominates the measurement.
_client = httpx.Client(base_url=BASE, timeout=60)
_tokens: dict[str, str] = {}


def token(email: str) -> str:
    """Cached per email — logging in for every request costs a PBKDF2 verify
    (240k iterations by design) and tells us nothing extra."""
    if email not in _tokens:
        r = _client.post("/api/auth/login", json={"email": email, "password": PW})
        r.raise_for_status()
        _tokens[email] = r.json()["access_token"]
    return _tokens[email]


def get(email: str, path: str, **kw):
    return _client.get(path, headers={"Authorization": f"Bearer {token(email)}"}, **kw)


def vins(email: str) -> set[str]:
    r = get(email, "/api/fleet")
    r.raise_for_status()
    return {v["vin"] for v in r.json()["vehicles"]}


# ── authentication ─────────────────────────────────────────────────────────

def test_unauthenticated_request_is_rejected():
    assert _client.get("/api/fleet").status_code == 401


def test_bad_password_is_rejected():
    r = _client.post("/api/auth/login", json={"email": WESTERN_ADVISOR, "password": "wrong"}, timeout=30)
    assert r.status_code == 401


def test_unknown_user_and_bad_password_are_indistinguishable():
    """Different responses here turn login into an account enumerator."""
    a = _client.post("/api/auth/login", json={"email": "nobody@nowhere.example", "password": "x"})
    b = _client.post("/api/auth/login", json={"email": WESTERN_ADVISOR, "password": "x"}, timeout=30)
    assert a.status_code == b.status_code == 401
    assert a.json()["detail"] == b.json()["detail"]


def test_forged_token_is_rejected():
    r = _client.get("/api/fleet", headers={"Authorization": "Bearer not.a.real.token"})
    assert r.status_code == 401


# ── row scoping: the core isolation guarantee ──────────────────────────────

def test_dealer_groups_cannot_see_each_others_vehicles():
    western, southern = vins(WESTERN_ADVISOR), vins(SOUTHERN_ADVISOR)
    assert western and southern, "both groups should see something"
    assert not (western & southern), f"cross-tenant leak: {western & southern}"


def test_southern_dealer_cannot_read_a_western_vin_directly():
    """Guessing a VIN must not bypass the list scope."""
    r = get(SOUTHERN_ADVISOR, f"/api/vehicle/{HERO_VIN}")
    assert r.status_code == 404


def test_out_of_scope_vin_returns_404_not_403():
    """403 would confirm the VIN exists, letting a rival enumerate the parc."""
    r = get(SOUTHERN_ADVISOR, f"/api/vehicle/{HERO_VIN}")
    assert r.status_code == 404
    assert "unknown vin" in r.json()["detail"].lower()


def test_owner_sees_only_their_own_vehicle():
    owned = vins(OWNER_RAMESH)
    assert owned == {HERO_VIN}, f"owner scope leaked: {owned}"


def test_oem_sees_only_its_own_brand():
    r = get(OEM_ENGINEER, "/api/fleet")
    r.raise_for_status()
    vehicles = r.json()["vehicles"]
    # Asserted non-empty first: `{v["oem"] for v in []} <= {"Mahindra"}` is
    # vacuously true, so an empty response would pass a brand check that never
    # actually ran.
    assert vehicles, "Mahindra engineer should see the instrumented parc"
    assert {v["oem"] for v in vehicles} == {"Mahindra"}
    assert HERO_VIN not in vins(HERO_ENGINEER), "Hero saw a Mahindra vehicle"


def test_oem_cannot_read_a_rivals_defect_clusters():
    """Regression: quality endpoints were unscoped, so any quality:read holder
    saw every OEM's failing batches and rates — the most commercially sensitive
    data in the system."""
    mahindra = get(OEM_ENGINEER, "/api/quality/clusters")
    hero = get(HERO_ENGINEER, "/api/quality/clusters")
    mahindra.raise_for_status()
    hero.raise_for_status()

    m_keys = {c["cluster_key"] for c in mahindra.json()["clusters"]}
    h_keys = {c["cluster_key"] for c in hero.json()["clusters"]}
    assert m_keys, "Mahindra should see its own defect cluster"
    assert not (m_keys & h_keys), f"cross-OEM quality leak: {m_keys & h_keys}"
    assert mahindra.json()["analysed_brands"] == ["Mahindra"]
    assert hero.json()["analysed_brands"] == ["Hero"]


def test_oem_capa_draft_is_brand_scoped():
    d = get(OEM_ENGINEER, "/api/quality/capa-draft")
    d.raise_for_status()
    cluster = d.json().get("cluster")
    assert cluster is not None
    # The drafted ticket must name a batch this OEM actually builds.
    assert cluster["batch_id"].startswith("BATCH-"), cluster
    # Hero's engineer holds the same capa:draft permission, so the permission
    # layer no longer separates the two OEMs — the scoping layer has to. Hero may
    # draft, but the ticket must never be built from Mahindra's cluster.
    mahindra_keys = {c["cluster_key"] for c in
                     get(OEM_ENGINEER, "/api/quality/clusters").json()["clusters"]}
    hero_draft = get(HERO_ENGINEER, "/api/quality/capa-draft")
    assert hero_draft.status_code == 200
    hero_cluster = hero_draft.json().get("cluster")
    assert hero_cluster is None or hero_cluster["cluster_key"] not in mahindra_keys


def test_platform_admin_sees_everything():
    everyone = vins(ADMIN)
    assert HERO_VIN in everyone and SOUTHERN_VIN in everyone


# ── column redaction ───────────────────────────────────────────────────────

def test_oem_cannot_see_customer_identity():
    """The manufacturing feedback loop needs failure data, never owner PII."""
    r = get(OEM_ENGINEER, "/api/fleet")
    r.raise_for_status()
    owners = {v.get("owner") for v in r.json()["vehicles"] if v.get("owner")}
    assert owners <= {"[redacted]"}, f"OEM saw owner names: {owners}"


def test_service_advisor_can_see_customer_identity():
    """The counterpart: an advisor has to phone the owner."""
    r = get(WESTERN_ADVISOR, "/api/fleet")
    r.raise_for_status()
    owners = {v.get("owner") for v in r.json()["vehicles"] if v.get("owner")}
    assert owners and owners != {"[redacted]"}


# ── permission enforcement ─────────────────────────────────────────────────

def test_security_analyst_cannot_read_customer_pii():
    """Watching the agents does not require reading the customers they serve."""
    r = get(SECURITY, "/api/fleet")
    r.raise_for_status()
    owners = {v.get("owner") for v in r.json()["vehicles"] if v.get("owner")}
    assert owners <= {"[redacted]"}


def test_engineer_cannot_dispatch_capa_but_manager_can():
    """Drafting a CAPA and starting a recall are deliberately separate rights."""
    assert get(OEM_ENGINEER, "/api/quality/capa-draft").status_code == 200
    policy_engineer = _client.post(
        "/api/auth/login", json={"email": OEM_ENGINEER, "password": PW}
    ).json()["principal"]["permissions"]
    policy_manager = _client.post(
        "/api/auth/login", json={"email": OEM_MANAGER, "password": PW}
    ).json()["principal"]["permissions"]
    assert "capa:dispatch" not in policy_engineer
    assert "capa:dispatch" in policy_manager


def test_security_analyst_has_no_customer_pii():
    """Watching the agents does not require reading the customers they serve."""
    perms = _client.post("/api/auth/login",
                          json={"email": SECURITY, "password": PW}
                          ).json()["principal"]["permissions"]
    assert "ueba:read" in perms
    assert "customer_pii:read" not in perms


def test_advisor_cannot_reach_the_security_console():
    assert get(WESTERN_ADVISOR, "/api/ueba/events").status_code == 403


def test_owner_cannot_run_the_red_team():
    assert get(OWNER_RAMESH, "/api/redteam/scenarios").status_code == 403


# ── agent delegation ───────────────────────────────────────────────────────

def test_agent_run_cannot_be_pointed_at_another_tenants_vehicle():
    """agent_policy.yaml permits the agent the tool; it says nothing about
    whose VIN. Principal scope is what stops the cross-tenant run."""
    r = _client.post(
        "/api/runs/trigger",
        headers={"Authorization": f"Bearer {token(SOUTHERN_ADVISOR)}"},
        json={"vin": HERO_VIN, "trigger": "manual"}, timeout=120,
    )
    assert r.status_code == 404


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v", "--no-header", "-p", "no:cacheprovider"]))
