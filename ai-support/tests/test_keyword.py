"""Tests for BM25 keyword search, RRF fusion, and their use in retrieval."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.keyword import BM25Index, rrf_fuse

CHUNKS = [
    {"id": "a", "title": "HbA1c Test", "content": "Glycated haemoglobin, 3 month sugar average"},
    {"id": "b", "title": "Lipid Profile", "content": "Cholesterol, triglycerides, HDL, LDL"},
    {"id": "c", "title": "Refund policy", "content": "Refunds are processed in 5 to 7 days"},
]


def test_bm25_finds_exact_code():
    assert [r["id"] for r in BM25Index(CHUNKS).search("price of hba1c?")] == ["a"]


def test_bm25_ignores_stopwords_only_query():
    assert BM25Index(CHUNKS).search("what is the") == []


def test_bm25_empty_corpus():
    assert BM25Index([]).search("hba1c") == []


def test_rrf_rewards_agreement_and_keeps_first_list_fields():
    dense = [{"id": "x", "similarity": 0.9}, {"id": "y", "similarity": 0.8}]
    keyword = [{"id": "y", "bm25": 4.0}, {"id": "z", "bm25": 2.0}]
    fused = rrf_fuse(dense, keyword)
    assert [r["id"] for r in fused] == ["y", "x", "z"]
    assert fused[0]["similarity"] == 0.8 and fused[0]["bm25"] == 4.0


@pytest.mark.asyncio
async def test_retrieve_adds_keyword_hits(mock_db, settings, sample_chunks):
    mock_db.vector_search = AsyncMock(return_value=sample_chunks)
    mock_db.keyword_search = AsyncMock(
        return_value=[{"id": "kw-only", "source": "catalog", "title": "HbA1c", "content": "x", "bm25": 9.0}]
    )
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import retrieve

        result = await retrieve("hba1c", mock_db, settings)

    ids = [c.id for c in result.chunks]
    assert "kw-only" in ids
    assert next(c for c in result.chunks if c.id == "kw-only").similarity == 0.0


@pytest.mark.asyncio
async def test_keyword_hits_do_not_override_abstention(mock_db, settings, low_similarity_chunks):
    mock_db.vector_search = AsyncMock(return_value=low_similarity_chunks)
    mock_db.keyword_search = AsyncMock(return_value=[{"id": "kw", "title": "t", "content": "c", "bm25": 9.0}])
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import retrieve

        result = await retrieve("book me a flight", mock_db, settings)

    assert result.should_abstain and result.chunks == []
