"""Tests for RCA/CAPA pipeline"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

FAILURES = [
    {"vin": "MH12AB1001", "component": "water_pump", "batch_id": "BATCH-TEST"},
    {"vin": "TN09GH4001", "component": "water_pump", "batch_id": "BATCH-TEST"},
    {"vin": "MH02KL6001", "component": "water_pump", "batch_id": "BATCH-TEST"},
]

def test_cluster():
    from app.rca_capa.pipeline import cluster_failures
    clusters = cluster_failures(FAILURES)
    assert len(clusters) == 1

def test_rca_pipeline():
    from app.rca_capa.pipeline import run_rca_pipeline
    reports = run_rca_pipeline(FAILURES)
    assert len(reports) == 1
    r = reports[0]
    assert r["component"] == "water_pump"
    assert len(r["five_why"]) == 5
    assert len(r["corrective_actions"]) > 0

def test_five_why_structure():
    from app.rca_capa.pipeline import generate_five_why
    fws = generate_five_why("water_pump", 3, "BATCH-TEST")
    assert len(fws) == 5
    assert all("why" in f and "answer" in f for f in fws)
