"""Tests for the retrieval-only eval: IR metrics, miss diagnosis, regression gate, offline cache."""
from __future__ import annotations

import json

import pytest

from app.eval.corpus import EmbeddingCache, MissingEmbeddingsError, build_chunks
from app.eval.ir_metrics import hit_at_k, ndcg_at_k, recall_at_k, reciprocal_rank
from app.eval.retrieval_runner import SET_PATH, regressions, score, validate


def test_recall_counts_share_of_relevant_in_top_k():
    assert recall_at_k(["a", "b", "c"], ["a", "c"], 2) == 0.5
    assert recall_at_k(["a", "b", "c"], ["a", "c"], 3) == 1.0
    assert recall_at_k([], ["a"], 5) == 0.0


def test_hit_and_reciprocal_rank_use_first_relevant_position():
    assert hit_at_k(["x", "a"], ["a"], 1) == 0.0
    assert hit_at_k(["x", "a"], ["a"], 2) == 1.0
    assert reciprocal_rank(["x", "y", "a"], ["a"]) == pytest.approx(1 / 3)
    assert reciprocal_rank(["x", "y", "a"], ["a"], k=2) == 0.0


def test_ndcg_is_one_for_ideal_order_and_lower_when_relevant_sinks():
    assert ndcg_at_k(["a", "b", "x"], ["a", "b"], 5) == pytest.approx(1.0)
    assert ndcg_at_k(["x", "a", "b"], ["a", "b"], 5) < 1.0
    assert ndcg_at_k(["x", "y"], ["a"], 5) == 0.0


def _row(id_, relevant, final, abstained=False, dense=(), bm25=(), category="direct", sim=0.7):
    return {
        "id": id_, "category": category, "query": id_, "relevant": relevant, "final": final,
        "abstained": abstained, "top_dense_similarity": sim,
        "dense_top20": list(dense), "bm25_top20": list(bm25),
    }


def test_score_classifies_each_kind_of_miss():
    rows = [
        _row("hit", ["a"], ["a"]),
        _row("reorder", ["a"], ["x"], dense=["x", "a"]),
        _row("lost", ["a"], ["x"], dense=["x"], bm25=["y"]),
        _row("gated", ["a"], [], abstained=True, dense=["a"]),
        _row("off", [], [], abstained=True, category="abstain", sim=0.5),
    ]
    s = score(rows)
    assert s["misses"] == {"ordering": ["reorder"], "not_found": ["lost"], "abstained": ["gated"]}
    assert s["recall@5"] == 0.25
    assert s["false_abstention_rate"] == 0.25
    assert s["abstention_accuracy"] == 1.0
    assert s["off_topic_top_sim_max"] == 0.5


def test_gate_flags_only_drops_beyond_tolerance():
    baseline = {"recall@5": 0.90, "mrr@5": 0.85, "false_abstention_rate": 0.0}
    assert regressions({"recall@5": 0.89, "mrr@5": 0.86, "false_abstention_rate": 0.01}, baseline) == []
    failed = regressions({"recall@5": 0.80, "mrr@5": 0.85, "false_abstention_rate": 0.10}, baseline)
    assert failed == ["recall@5: 0.900 -> 0.800", "false_abstention_rate: 0.000 -> 0.100"]


def test_every_label_in_the_retrieval_set_names_a_real_chunk():
    queries = json.loads(SET_PATH.read_text())["queries"]
    assert validate(queries, {c["id"] for c in build_chunks()}) == []
    assert len({q["id"] for q in queries}) == len(queries)


@pytest.mark.asyncio
async def test_offline_cache_raises_instead_of_calling_gemini(tmp_path, settings):
    cache = EmbeddingCache(settings, path=tmp_path / "e.json", offline=True)
    with pytest.raises(MissingEmbeddingsError):
        await cache.embed("never embedded")


@pytest.mark.asyncio
async def test_prune_keeps_only_vectors_used_this_run(tmp_path, settings):
    path = tmp_path / "e.json"
    seed = EmbeddingCache(settings, path=path)
    seed.data = {seed._key("keep", "RETRIEVAL_QUERY"): [1.0], seed._key("stale", "RETRIEVAL_QUERY"): [2.0]}
    seed.save()

    cache = EmbeddingCache(settings, path=path, offline=True)
    assert await cache.embed("keep") == [1.0]
    cache.save(prune=True)
    assert list(json.loads(path.read_text()).values()) == [[1.0]]


def test_constituent_names_are_cleaned_for_customer_queries():
    from app.eval.build_real_set import clean

    assert clean("Albumin, Serum") == "Albumin"
    assert clean("Allergy Grass-By Elisa Method") == "Allergy Grass"
    assert clean("HbA1c") == "HbA1c"


def test_coverage_counts_facts_stored_but_not_indexed():
    from app.eval.build_real_set import coverage

    item = {
        "name": "Big Package", "type": "PACKAGE", "displayPrice": 900, "discountedPrice": 500,
        "detailsData": {"reportingTime": "26 hrs", "fastingTime": 12,
                        "constituents": [{"name": f"T{n}"} for n in range(20)]},
    }
    c = coverage([item])
    assert c["report_time"] == {"stored": 1, "indexed": 0}
    assert c["all_constituents"] == {"stored": 1, "indexed": 0}
    assert c["constituents_lost"] == 5


def test_fake_express_serves_the_catalog_it_is_given():
    import httpx
    from app.eval.fake_express import FakeExpress

    express = FakeExpress(catalog=[{"name": "Real Lipid Profile", "partnerCode": "P1"}])
    resp = express(httpx.Request("GET", "http://x/api/catalog/products?search=lipid"))
    assert [p["name"] for p in resp.json()["products"]] == ["Real Lipid Profile"]
