"""Tests for BM25 keyword search, RRF fusion, and their use in retrieval."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.agents.keyword import BM25Index, rare_title_matches, rrf_fuse

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


def test_bm25_skips_terms_in_most_chunks():
    # "test" is in every chunk: it must not produce hits that RRF would credit by rank alone.
    chunks = [{"id": str(i), "title": f"Test {i}", "content": "test price"} for i in range(12)]
    chunks.append({"id": "na", "title": "Sodium, Serum", "content": "test price"})
    index = BM25Index(chunks)
    assert index.search("sodm test price") == []
    assert [r["id"] for r in index.search("sodium test")] == ["na"]


def test_bm25_ignores_question_filler():
    chunks = CHUNKS + [{"id": "d", "title": "Urea", "content": "Tells how much urea is in blood"}]
    assert [r["id"] for r in BM25Index(chunks).search("how much does hba1c cost")] == ["a"]


def test_rare_title_rescue_matches_short_code_queries_only():
    chunks = [{"id": str(i), "source": "catalog", "title": f"Test {i}", "content": "blood"} for i in range(12)]
    chunks.append({"id": "qft", "source": "catalog", "title": "Quantiferon-TB Gold (QFT)", "content": "blood"})
    chunks.append({"id": "faq", "source": "faq", "title": "Services We Don't Offer", "content": "x"})
    index = BM25Index(chunks)
    assert [c["id"] for c in rare_title_matches(index, "qft")] == ["qft"]
    assert [c["id"] for c in rare_title_matches(index, "qft test price")] == ["qft"]
    # Long questions carry enough context for the embedding; filler must not find rare titles.
    assert rare_title_matches(index, "is the qft gold test good for my uncle") == []
    # A term in many titles is not rare.
    assert rare_title_matches(index, "test") == []
    # FAQ and policy titles never rescue an off-topic question.
    assert rare_title_matches(index, "offer plumbing services") == []
