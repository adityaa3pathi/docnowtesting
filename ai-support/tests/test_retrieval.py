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
        assert len(result.chunks) == 0
