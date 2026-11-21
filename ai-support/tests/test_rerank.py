"""Reranker: Cohere call shape, RRF fallback on any failure, ordering, and the score gate."""
from __future__ import annotations

import json
from functools import partial
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.agents import rerank as rerank_mod
from app.agents.rerank import cohere_rerank, rerank

ROWS = [
    {"id": "iron-pkg", "source": "catalog", "title": "Iron Studies", "content": "Iron, TIBC, UIBC", "similarity": 0.74},
    {"id": "uibc", "source": "catalog", "title": "UIBC, Serum", "content": "Unsaturated iron binding capacity", "similarity": 0.73},
]


def _client_with(handler):
    return partial(httpx.AsyncClient, transport=httpx.MockTransport(handler))


@pytest.mark.asyncio
async def test_cohere_call_sends_query_and_maps_scores_back_to_input_order(settings):
    settings.cohere_api_key = "k"
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json={"results": [{"index": 1, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.2}]})

    with patch("app.agents.rerank.httpx.AsyncClient", _client_with(handler)):
        scores = await cohere_rerank("uibc price", ["a", "b"], settings)

    assert scores == [0.2, 0.9]
    assert seen["auth"] == "Bearer k"
    assert seen["body"]["model"] == "rerank-v3.5" and seen["body"]["documents"] == ["a", "b"]


@pytest.mark.asyncio
async def test_rerank_orders_by_score(settings):
    settings.cohere_api_key = "k"
    with patch.object(rerank_mod, "score_documents", AsyncMock(return_value=[0.1, 0.8])):
        ranked = await rerank("unsaturated iron binding capacity", ROWS, settings)
    assert [r["id"] for r, _ in ranked] == ["uibc", "iron-pkg"]


@pytest.mark.asyncio
@pytest.mark.parametrize("error", [httpx.ReadTimeout("slow"), httpx.HTTPStatusError("429", request=None, response=None), KeyError("results")])
async def test_any_failure_returns_none_so_the_caller_keeps_rrf(settings, error):
    settings.cohere_api_key = "k"
    with patch.object(rerank_mod, "score_documents", AsyncMock(side_effect=error)):
        assert await rerank("q", ROWS, settings) is None


@pytest.mark.asyncio
async def test_no_key_means_no_call(settings):
    settings.cohere_api_key = ""
    call = AsyncMock()
    with patch.object(rerank_mod, "score_documents", call):
        assert await rerank("q", ROWS, settings) is None
    call.assert_not_awaited()


async def _retrieve(settings, mock_db, scores, index_rows=()):
    async def search(embedding, limit=10, *, source=None, exclude_source=None):
        return list(index_rows) if source == "catalog_index" else ROWS

    mock_db.vector_search = AsyncMock(side_effect=search)
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768), \
            patch.object(rerank_mod, "score_documents", AsyncMock(**scores)):
        from app.agents.retrieval import retrieve

        return await retrieve("unsaturated iron binding capacity", mock_db, settings)


@pytest.mark.asyncio
async def test_retrieve_uses_reranker_order_when_enabled(settings, mock_db):
    settings.rerank_enabled, settings.cohere_api_key = True, "k"
    result = await _retrieve(settings, mock_db, {"return_value": [0.1, 0.8]})
    assert [c.id for c in result.chunks] == ["uibc", "iron-pkg"]
    assert result.rerank_top_score == 0.8


@pytest.mark.asyncio
async def test_retrieve_keeps_rrf_order_when_reranker_fails(settings, mock_db):
    settings.rerank_enabled, settings.cohere_api_key, settings.rerank_min_score = True, "k", 0.5
    result = await _retrieve(settings, mock_db, {"side_effect": httpx.ReadTimeout("slow")})
    assert [c.id for c in result.chunks] == ["iron-pkg", "uibc"]
    # A failed rerank must never abstain, whatever the gate says.
    assert not result.should_abstain and result.rerank_top_score is None


@pytest.mark.asyncio
async def test_reranker_gate_abstains_below_min_score(settings, mock_db):
    settings.rerank_enabled, settings.cohere_api_key, settings.rerank_min_score = True, "k", 0.3
    result = await _retrieve(settings, mock_db, {"return_value": [0.05, 0.1]})
    assert result.should_abstain and not result.failed
    assert result.chunks == []


@pytest.mark.asyncio
async def test_index_chunk_is_scored_but_stays_last(settings, mock_db):
    settings.rerank_enabled, settings.cohere_api_key = True, "k"
    index_row = {"id": "idx", "source": "catalog_index", "title": "Packages with UIBC", "content": "...", "similarity": 0.9}
    result = await _retrieve(settings, mock_db, {"return_value": [0.1, 0.2, 0.95]}, index_rows=[index_row])
    assert [c.id for c in result.chunks] == ["uibc", "iron-pkg", "idx"]
    assert result.rerank_top_score == 0.95


@pytest.mark.asyncio
async def test_rerank_cache_pays_once_and_offline_misses_are_recorded(settings, tmp_path):
    from app.eval.rerank_cache import MissingRerankScoresError, RerankCache

    path = tmp_path / "scores.json"
    online = RerankCache(settings, path)
    with patch("app.eval.rerank_cache.cohere_rerank", AsyncMock(return_value=[0.4, 0.6])) as api:
        assert await online.score("q", ["a", "b"], settings) == [0.4, 0.6]
        assert await online.score("q", ["b", "a"], settings) == [0.6, 0.4]
    assert api.await_count == 1

    offline = RerankCache(settings, path, offline=True)
    assert await offline.score("q", ["a"], settings) == [0.4]
    with pytest.raises(MissingRerankScoresError):
        await offline.score("q", ["new doc"], settings)
    assert len(offline.failures) == 1


def test_gate_sweep_counts_only_scored_rows_against_the_threshold():
    from app.eval.retrieval_runner import gate_sweep

    rows = [
        {"id": "a", "relevant": ["x"], "abstained": False, "rerank_top_score": 0.9},
        {"id": "b", "relevant": ["y"], "abstained": False, "rerank_top_score": 0.04},
        {"id": "off", "relevant": [], "abstained": False, "rerank_top_score": 0.02},
        {"id": "off2", "relevant": [], "abstained": True, "rerank_top_score": None},
    ]
    by_t = {r["threshold"]: r for r in gate_sweep(rows)}
    assert by_t[0.03]["abstention_accuracy"] == 1.0 and by_t[0.03]["false_abstention_rate"] == 0.0
    assert by_t[0.05]["false_abstentions"] == ["b"]
