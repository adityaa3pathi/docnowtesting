"""Tests for the Retrieval Agent — vector search + relevance filtering."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest


class TestRetrievalAgent:
    """Test the retrieve() function."""

    @pytest.mark.asyncio
    async def test_retrieve_returns_relevant_chunks(self, mock_db, settings, sample_chunks):
        """Should return chunks above the relevance threshold."""
        mock_db.vector_search = AsyncMock(return_value=sample_chunks)

        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 768

            from app.agents.retrieval import retrieve

            result = await retrieve("full body checkup", mock_db, settings)

        assert not result.should_abstain
        assert len(result.chunks) > 0
        assert result.max_similarity == pytest.approx(0.92, abs=0.01)
        # All returned chunks should be above threshold
        for chunk in result.chunks:
            assert chunk.similarity >= settings.relevance_threshold

    @pytest.mark.asyncio
    async def test_retrieve_abstains_when_no_relevant_chunks(
        self, mock_db, settings, low_similarity_chunks
    ):
        """Should set should_abstain=True when no chunk clears the threshold."""
        mock_db.vector_search = AsyncMock(return_value=low_similarity_chunks)

        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 768

            from app.agents.retrieval import retrieve

            result = await retrieve("book me a flight to Delhi", mock_db, settings)

        assert result.should_abstain is True
        assert result.failed is False  # a real abstention, not the error path
        assert len(result.chunks) == 0
        assert result.max_similarity == 0.0

    @pytest.mark.asyncio
    async def test_retrieve_limits_to_top_k(self, mock_db, settings):
        """Should return at most 5 chunks even if more pass the threshold."""
        many_chunks = [
            {
                "id": f"chunk-{i}",
                "source": "catalog",
                "sourceId": f"cat-{i}",
                "title": f"Test {i}",
                "content": f"Content for test {i}",
                "metadata": None,
                "similarity": 0.95 - (i * 0.01),
            }
            for i in range(10)
        ]
        mock_db.vector_search = AsyncMock(return_value=many_chunks)

        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 768

            from app.agents.retrieval import retrieve

            result = await retrieve("health tests", mock_db, settings)

        assert len(result.chunks) <= 5

    @pytest.mark.asyncio
    async def test_retrieve_stores_query_embedding(self, mock_db, settings, sample_chunks):
        """Should include the query embedding in the result for eval scoring."""
        mock_db.vector_search = AsyncMock(return_value=sample_chunks)
        expected_embedding = [0.5] * 768

        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = expected_embedding

            from app.agents.retrieval import retrieve

            result = await retrieve("thyroid test", mock_db, settings)

        assert len(result.query_embedding) == 768
        assert result.query_embedding == expected_embedding

    @pytest.mark.asyncio
    async def test_retrieve_with_empty_db(self, mock_db, settings):
        """Should abstain when the database returns no results."""
        mock_db.vector_search = AsyncMock(return_value=[])

        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock) as mock_embed:
            mock_embed.return_value = [0.1] * 768

            from app.agents.retrieval import retrieve

            result = await retrieve("anything", mock_db, settings)

        assert result.should_abstain is True
        assert result.failed is False
        assert len(result.chunks) == 0


@pytest.mark.asyncio
async def test_index_chunk_is_appended_after_the_item_top_k(mock_db, settings, sample_chunks):
    index_row = {"id": "idx", "source": "catalog_index", "title": "Packages with B12", "content": "...", "similarity": 0.9}

    async def search(embedding, limit=10, *, source=None, exclude_source=None):
        return [index_row] if source == "catalog_index" else sample_chunks

    mock_db.vector_search = AsyncMock(side_effect=search)
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import TOP_K, retrieve

        result = await retrieve("which packages include b12", mock_db, settings)

    assert [c.id for c in result.chunks][-1] == "idx"
    assert sum(c.source != "catalog_index" for c in result.chunks) <= TOP_K
    assert result.chunks[-1].similarity == 0.9


@pytest.mark.asyncio
async def test_index_only_hit_answers_without_keyword_chunks(mock_db, settings):
    index_row = {"id": "idx", "source": "catalog_index", "title": "t", "content": "c", "similarity": 0.8}
    weak = [{"id": "w", "source": "catalog", "title": "t", "content": "c", "similarity": 0.3}]

    async def search(embedding, limit=10, *, source=None, exclude_source=None):
        return [index_row] if source == "catalog_index" else weak

    mock_db.vector_search = AsyncMock(side_effect=search)
    mock_db.keyword_search = AsyncMock(return_value=[{"id": "kw", "source": "catalog", "title": "t", "content": "c"}])
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import retrieve

        result = await retrieve("bacteria", mock_db, settings)

    assert not result.should_abstain
    assert [c.id for c in result.chunks] == ["idx"]
    mock_db.keyword_search.assert_not_awaited()


@pytest.mark.asyncio
async def test_rescue_returns_rare_title_hits_when_dense_abstains(mock_db, settings, low_similarity_chunks):
    rescue_row = {"id": "qft", "source": "catalog", "title": "Quantiferon-TB Gold (QFT)", "content": "c"}
    mock_db.vector_search = AsyncMock(return_value=low_similarity_chunks)
    mock_db.rare_title_search = AsyncMock(return_value=[rescue_row])
    settings.bm25_rescue_enabled = True
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import retrieve

        result = await retrieve("qft", mock_db, settings)

    assert not result.should_abstain and result.rescued
    assert [c.id for c in result.chunks] == ["qft"]


@pytest.mark.asyncio
async def test_rescue_can_be_switched_off(mock_db, settings, low_similarity_chunks):
    settings.bm25_rescue_enabled = False
    mock_db.vector_search = AsyncMock(return_value=low_similarity_chunks)
    mock_db.rare_title_search = AsyncMock(return_value=[{"id": "x", "title": "X"}])
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 768):
        from app.agents.retrieval import retrieve

        result = await retrieve("qft", mock_db, settings)

    assert result.should_abstain and not result.rescued
