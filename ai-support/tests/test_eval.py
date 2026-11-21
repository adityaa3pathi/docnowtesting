"""Tests for the eval harness: in-memory KB, fake Express, and our own metrics."""
from __future__ import annotations

from functools import partial
from unittest.mock import patch

import httpx
import pytest

from app.eval.corpus import InMemoryKnowledgeBase, build_chunks
from app.eval.fake_express import FakeExpress
from app.eval.scorer import EvalResult, custom_metrics


def _result(**overrides) -> EvalResult:
    base = dict(
        query_id="q", category="catalog", query="q", response="r",
        retrieved_contexts=["c"], retrieved_sources=["catalog"], ground_truth="g",
        should_abstain=False, was_abstained=False, verifier_verdict="GROUNDED",
        expected_source="catalog", expected_tool=None, tools_called=[], latency_ms=100,
    )
    return EvalResult(**{**base, **overrides})


def test_build_chunks_uses_catalog_formatter_and_static_docs():
    chunks = build_chunks()
    sources = {c["source"] for c in chunks}
    assert {"catalog", "policy", "faq", "booking_help"} <= sources
    cbc = next(c for c in chunks if c["title"] == "Complete Blood Count (CBC)")
    assert cbc["content"].startswith("Test Name: Complete Blood Count (CBC)")
    assert "Price: ₹299 (MRP: ₹400)" in cbc["content"]


@pytest.mark.asyncio
async def test_in_memory_search_orders_by_cosine_similarity():
    chunks = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    kb = InMemoryKnowledgeBase(chunks, [[1, 0], [0, 1], [0.7, 0.7]])
    rows = await kb.vector_search([1, 0], limit=2)
    assert [r["id"] for r in rows] == ["a", "c"]
    assert rows[0]["similarity"] == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_fake_express_serves_bookings_and_records_calls():
    express = FakeExpress()
    auth = {"Authorization": "Bearer t"}
    async with httpx.AsyncClient(transport=httpx.MockTransport(express)) as client:
        ok = await client.get("http://x/api/bookings/12345/status", headers=auth)
        missing = await client.post("http://x/api/bookings/nope/cancel", headers=auth)
        anon = await client.get("http://x/api/bookings", headers={"Cookie": "accessToken=t"})
    assert ok.json()["status"] == "Sample Collector Assigned"
    assert missing.status_code == 404
    assert anon.status_code == 401
    assert express.calls == [
        ("GET", "/bookings/12345/status"), ("POST", "/bookings/nope/cancel"), ("GET", "/bookings"),
    ]


@pytest.mark.asyncio
async def test_booking_tool_sends_bearer_token(agent_context, settings):
    """Express only reads the docnow_access cookie or a Bearer header."""
    from app.agents.action import execute_action
    from app.models import Intent

    express = FakeExpress()
    client = partial(httpx.AsyncClient, transport=httpx.MockTransport(express))
    with patch("app.agents.action.httpx.AsyncClient", client):
        result = await execute_action(Intent(intent="BOOKING_LIST", tool_name="list_bookings"), agent_context, settings)
    assert result.success, result.error


def test_custom_metrics():
    results = [
        _result(),
        _result(retrieved_sources=["faq"], was_abstained=True, verifier_verdict="UNGROUNDED"),
        _result(should_abstain=True, was_abstained=False, expected_source=None),
        _result(category="booking", expected_source=None, expected_tool="list_bookings",
                tools_called=["list_bookings"]),
    ]
    m = custom_metrics(results)
    assert m["abstention_accuracy"] == pytest.approx(2 / 4)
    assert m["false_abstention_rate"] == pytest.approx(1 / 3)
    assert m["missed_abstention_rate"] == 1.0
    assert m["source_hit_rate"] == pytest.approx(1 / 2)
    assert m["tool_choice_accuracy"] == 1.0


def test_custom_metrics_reports_none_when_nothing_to_measure():
    m = custom_metrics([_result(expected_tool=None)])
    assert m["tool_choice_accuracy"] is None
    assert m["missed_abstention_rate"] is None


def _usage(total: int, cap_hits: int = 0, per_call: list | None = None) -> dict:
    return {"total_tokens": total, "cap_hits": cap_hits, "calls": len(per_call or []), "per_call": per_call or []}


def test_custom_metrics_reports_token_use():
    draft = {"stage": "draft", "output_tokens": 90, "thought_tokens": 10}
    intent = {"stage": "intent", "output_tokens": 20, "thought_tokens": 0}
    results = [
        _result(usage=_usage(1000, per_call=[intent, draft])),
        _result(usage=_usage(3000, cap_hits=1, per_call=[intent, {**draft, "output_tokens": 190}])),
    ]
    m = custom_metrics(results)
    assert m["tokens_per_turn_mean"] == 2000
    assert m["tokens_per_turn_p95"] == 3000
    assert m["cap_hit_rate"] == pytest.approx(1 / 4)
    assert m["draft_output_p99"] == 200
    assert m["intent_output_p99"] == 20


def test_token_metrics_are_none_without_usage():
    m = custom_metrics([_result()])
    assert m["tokens_per_turn_mean"] is None
    assert m["cap_hit_rate"] is None


def test_groundedness_ignores_tool_only_answers():
    m = custom_metrics([_result(), _result(verifier_verdict="TOOL_ONLY", expected_source=None)])
    assert m["groundedness_score"] == 1.0


def test_tool_choice_accepts_listed_alternatives_and_kb_only_answers():
    from app.eval.scorer import tool_choice_correct

    strict = dict(expected_tool="get_booking_status")
    assert tool_choice_correct(_result(**strict, tools_called=["get_booking_status"]))
    assert not tool_choice_correct(_result(**strict, tools_called=["list_bookings"]))
    assert tool_choice_correct(_result(**strict, tools_called=["list_bookings"], acceptable_tools=["list_bookings"]))
    # "none" accepts a KB answer, but a wrong tool is still wrong.
    kb_ok = dict(expected_tool="search_catalog", acceptable_tools=["none"])
    assert tool_choice_correct(_result(**kb_ok, tools_called=[]))
    assert not tool_choice_correct(_result(**kb_ok, tools_called=["list_bookings"]))


def test_verifier_pass_rate_counts_only_drafts_the_verifier_checked():
    results = [
        _result(verifier_ran=True),
        _result(verifier_ran=True, verifier_verdict="UNGROUNDED", was_abstained=True),
        # Off-topic refusal: the orchestrator labels it UNGROUNDED but no verifier ran.
        _result(verifier_verdict="UNGROUNDED", should_abstain=True, was_abstained=True),
        _result(verifier_verdict=None, expected_tool="cancel_booking", tools_called=["cancel_booking"]),
    ]
    m = custom_metrics(results)
    assert m["verifier_pass_rate"] == pytest.approx(1 / 2)
    assert m["verifier_block_rate"] == pytest.approx(1 / 2)
    assert m["groundedness_score"] == pytest.approx(1 / 4)  # legacy definition unchanged


def test_aggregate_runs_reports_mean_and_sample_std():
    from app.eval.scorer import aggregate_runs

    agg = aggregate_runs([{"a": 0.6, "b": None}, {"a": 0.8, "b": None}, {"a": 0.7, "b": 3}])
    assert agg["a"]["mean"] == pytest.approx(0.7)
    assert agg["a"]["std"] == pytest.approx(0.1)
    assert agg["b"] == {"mean": 3, "std": 0.0, "n": 1, "min": 3, "max": 3}


def test_query_stability_flags_queries_whose_outcome_flips():
    from app.eval.scorer import query_stability

    steady = dict(query_id="s", expected_tool="list_bookings", tools_called=["list_bookings"])
    flaky = dict(query_id="f", expect_any=["10 h"], verifier_ran=True)
    rows = query_stability([
        _result(**steady, repeat=0), _result(**steady, repeat=1),
        _result(**flaky, response="ready in 10 h", repeat=0),
        _result(**flaky, response="no idea", verifier_verdict="UNGROUNDED", tools_called=["list_bookings"], repeat=1),
    ])
    assert rows["s"]["flaky"] == []
    assert rows["f"]["flaky"] == ["probe_ok", "tools", "verdicts"]
    assert rows["f"]["probe_ok"] == {"True": 1, "False": 1}


def test_abstain_ok_queries_are_left_out_of_abstention_metrics():
    either = dict(should_abstain=True, abstain_ok=True, expected_source=None)
    m = custom_metrics([_result(), _result(**either, was_abstained=False)])
    assert m["abstention_accuracy"] == 1.0
    assert m["missed_abstention_rate"] is None
