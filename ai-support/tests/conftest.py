"""Shared test fixtures and configuration."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.config import Settings
from app.models import AgentContext


@pytest.fixture
def settings() -> Settings:
    """Test settings with safe defaults."""
    return Settings(
        database_url="postgresql://test:test@localhost:5432/test",
        express_api_url="http://localhost:5000/api",
        gemini_api_key="test-key",
        embedding_model="gemini-embedding-001",
        embedding_dimensions=768,
        llm_model="gemini-2.0-flash",
        relevance_threshold=0.7,
        max_tokens=4000,
        max_conversation_turns=10,
        jwt_secret="test-secret",
        enabled=True,
    )


@pytest.fixture
def mock_db() -> MagicMock:
    """Mock database with async methods."""
    db = MagicMock()
    db.pool = MagicMock()
    db.vector_search = AsyncMock(return_value=[])
    db.insert_chunk = AsyncMock()
    db.get_conversation = AsyncMock(return_value={"id": "conv-1", "userId": "user-1"})
    db.create_conversation = AsyncMock(return_value="conv-1")
    db.add_message = AsyncMock(return_value="msg-1")
    db.get_conversation_messages = AsyncMock(return_value=[])
    db.update_feedback = AsyncMock()
    return db


@pytest.fixture
def agent_context() -> AgentContext:
    """Sample authenticated agent context."""
    return AgentContext(
        user_id="user-123",
        is_authenticated=True,
        access_token="test-token",
        conversation_id="conv-123",
        conversation_history=[],
    )


@pytest.fixture
def unauthenticated_context() -> AgentContext:
    """Sample unauthenticated agent context."""
    return AgentContext(
        user_id=None,
        is_authenticated=False,
        access_token=None,
        conversation_id="ephemeral",
        conversation_history=[],
    )


@pytest.fixture
def sample_chunks() -> list[dict]:
    """Sample vector search results."""
    return [
        {
            "id": "chunk-1",
            "source": "catalog",
            "sourceId": "cat-1",
            "title": "Full Body Health Checkup",
            "content": "Test Name: Full Body Health Checkup\nType: PACKAGE\nPrice: ₹1499",
            "metadata": {"type": "PACKAGE", "displayPrice": 1499},
            "similarity": 0.92,
        },
        {
            "id": "chunk-2",
            "source": "policy",
            "sourceId": None,
            "title": "Cancellation Policy",
            "content": "Free cancellation is available when your booking is in Order Booked status.",
            "metadata": {"source": "policy"},
            "similarity": 0.85,
        },
        {
            "id": "chunk-3",
            "source": "faq",
            "sourceId": None,
            "title": "How Home Collection Works",
            "content": "A certified phlebotomist arrives at your home at the scheduled time.",
            "metadata": {"source": "faq"},
            "similarity": 0.78,
        },
    ]


@pytest.fixture
def low_similarity_chunks() -> list[dict]:
    """Chunks that fall below the relevance threshold."""
    return [
        {
            "id": "chunk-low",
            "source": "catalog",
            "sourceId": "cat-99",
            "title": "Unrelated Test",
            "content": "Some unrelated content",
            "metadata": None,
            "similarity": 0.45,
        },
    ]
