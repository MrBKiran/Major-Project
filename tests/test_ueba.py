"""Tests for UEBA engine"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

def test_policy_allow():
    from app.ueba.engine import check_policy
    allowed, reason = check_policy("data_analysis_agent", "telemetry.read")
    assert allowed

def test_policy_block():
    from app.ueba.engine import check_policy
    allowed, reason = check_policy("scheduling_agent", "telemetry.read")
    assert not allowed

def test_master_allow_all():
    from app.ueba.engine import check_policy
    allowed, _ = check_policy("master_agent", "anything.at.all")
    assert allowed

def test_evaluate_call_block():
    from app.ueba.engine import evaluate_call
    result = evaluate_call("test-run", "scheduling_agent", "telemetry.read", {})
    assert result["decision"] == "BLOCK"

def test_evaluate_call_allow():
    from app.ueba.engine import evaluate_call
    result = evaluate_call("test-run", "data_analysis_agent", "telemetry.read", {})
    assert result["decision"] == "ALLOW"
