"""
Phase 2 — /api/health is unauthenticated, so it may say only "up" or "down".

It used to also report the registered tool count, the agent names, that the UEBA
layer was armed, database latency, and — most usefully to an attacker — whether
the JWT signing key was the built-in one. None of that is anyone's business until
they have logged in, so it moved to /api/health/detail behind `ueba:read`.
"""

from __future__ import annotations

import pytest

from app import api_health

from .helpers import bearer, make_user, token_for


def test_public_health_says_only_up_or_down(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert set(body) == {"ok", "checks"}
    assert body["ok"] is True
    assert set(body["checks"]) == {"database", "mqtt", "ml_artifacts"}
    for name, check in body["checks"].items():
        assert set(check) == {"ok"}, f"{name} reports more than up/down: {check}"


def test_public_health_names_nothing_internal(client):
    text = client.get("/api/health").text.lower()
    for leaked in ("latency", "hypertable", "jwt", "secret", "tools_registered",
                   "agents", "ueba", "missing", "signing"):
        assert leaked not in text, f"public health output mentions {leaked!r}"


def test_a_failing_dependency_is_reported_down_without_the_reason(client, monkeypatch):
    monkeypatch.setattr(api_health, "_check_database",
                        lambda: {"ok": False, "error": "OperationalError"})
    r = client.get("/api/health")
    assert r.status_code == 503
    assert r.json()["ok"] is False
    assert r.json()["checks"]["database"] == {"ok": False}


def test_liveness_and_readiness_stay_public(client):
    assert client.get("/api/health/live").status_code == 200
    assert client.get("/api/health/ready").status_code == 200


# ── the detail moves behind a permission ───────────────────────────────────

def test_health_detail_requires_authentication(client):
    assert client.get("/api/health/detail").status_code == 401


def test_health_detail_is_forbidden_without_ueba_read(client):
    u = make_user()
    tok = token_for(client, u["email"], u["password"])
    assert client.get("/api/health/detail", headers=bearer(tok)).status_code == 403


@pytest.mark.parametrize("email", ["soc@autosaarthi.io", "admin@autosaarthi.io"])
def test_health_detail_gives_operators_the_full_picture(client, email):
    r = client.get("/api/health/detail", headers=bearer(token_for(client, email)))
    assert r.status_code == 200
    body = r.json()
    assert {"ok", "checks", "tools_registered", "agents", "ueba", "auth"} <= set(body)
    assert "latency_ms" in body["checks"]["database"]
    assert body["auth"]["signing_key"] == "configured"
    assert "jwt_secret_configured" not in body["auth"]
