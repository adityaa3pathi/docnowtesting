"""Tests for the eval harness: in-memory KB, fake Express, and our own metrics."""
from __future__ import annotations

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
    async with httpx.AsyncClient(transport=httpx.MockTransport(express)) as client:
        ok = await client.get("http://x/api/bookings/12345/status")
        missing = await client.post("http://x/api/bookings/nope/cancel")
    assert ok.json()["status"] == "Sample Collector Assigned"
    assert missing.status_code == 404
    assert express.calls == [("GET", "/bookings/12345/status"), ("POST", "/bookings/nope/cancel")]


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
