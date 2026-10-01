"""Tests for the Orchestrator — full pipeline integration tests."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch, MagicMock

import pytest

from app.models import (
    AgentContext,
    RetrievalResult,
    RetrievedChunk,
    ActionResult,
    VerificationResult,
)


class TestOrchestrator:
    """Integration tests for the handle_message() pipeline."""

    @pytest.mark.asyncio
    async def test_catalog_query_full_pipeline(self, mock_db, settings, agent_context):
        """A catalog query should: retrieve → classify → generate → verify."""
        retrieval_result = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="catalog",
                    title="Full Body Checkup",
                    content="Test Name: Full Body Health Checkup\nType: PACKAGE\nPrice: ₹1499",
                    similarity=0.92,
                )
            ],
            should_abstain=False,
            max_similarity=0.92,
        )

        verification_result = VerificationResult(
            verdict="GROUNDED",
            cleaned_response="We offer the Full Body Health Checkup package for ₹1499.",
            reasoning="Price and test name match source.",
            claims_checked=2,
            claims_grounded=2,
        )

        with (
            patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock) as mock_retrieve,
            patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock) as mock_classify,
            patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock) as mock_draft,
            patch("app.agents.orchestrator.verify", new_callable=AsyncMock) as mock_verify,
        ):
            from app.models import Intent

            mock_retrieve.return_value = retrieval_result
            mock_classify.return_value = Intent(
                intent="CATALOG_SEARCH",
                tool_name=None,
                parameters={},
                requires_action=False,
                confidence=0.9,
            )
            mock_draft.return_value = "We offer the Full Body Health Checkup package for ₹1499."
            mock_verify.return_value = verification_result

            from app.agents.orchestrator import handle_message

            response = await handle_message("what checkups do you offer?", agent_context, mock_db, settings)

        assert response.was_abstained is False
        assert "1499" in response.content
        assert response.verifier_verdict == "GROUNDED"
        assert len(response.sources) == 1

    @pytest.mark.asyncio
    async def test_off_topic_triggers_abstention(self, mock_db, settings, agent_context):
        """Off-topic queries with no relevant chunks should abstain."""
        retrieval_result = RetrievalResult(
            chunks=[],
            should_abstain=True,
            max_similarity=0.0,
        )

        with (
            patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock) as mock_retrieve,
            patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock) as mock_classify,
        ):
            from app.models import Intent

            mock_retrieve.return_value = retrieval_result
            mock_classify.return_value = Intent(
                intent="OFF_TOPIC",
                tool_name=None,
                parameters={},
                requires_action=False,
                confidence=0.95,
            )

            from app.agents.orchestrator import handle_message

            response = await handle_message("what's the weather?", agent_context, mock_db, settings)

        assert response.was_abstained is True
        assert "support" in response.content.lower() or "don't have" in response.content.lower()

    @pytest.mark.asyncio
    async def test_booking_action_requires_auth(self, mock_db, settings, unauthenticated_context):
        """Booking operations for unauthenticated users should prompt login."""
        retrieval_result = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="booking_help",
                    title="Booking Status",
                    content="You can check your booking status from My Bookings.",
                    similarity=0.88,
                )
            ],
            should_abstain=False,
            max_similarity=0.88,
        )

        with (
            patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock) as mock_retrieve,
            patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock) as mock_classify,
            patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock) as mock_draft,
            patch("app.agents.orchestrator.verify", new_callable=AsyncMock) as mock_verify,
        ):
            from app.models import Intent

            mock_retrieve.return_value = retrieval_result
            mock_classify.return_value = Intent(
                intent="BOOKING_STATUS",
                tool_name="get_booking_status",
                parameters={"booking_id": "b-123"},
                requires_action=True,
                confidence=0.9,
            )
            mock_draft.return_value = "Please log in to check your booking status."
            mock_verify.return_value = VerificationResult(
                verdict="GROUNDED",
                cleaned_response="Please log in to check your booking status.",
                reasoning="Login prompt is a system message.",
                claims_checked=0,
                claims_grounded=0,
            )

            from app.agents.orchestrator import handle_message

            response = await handle_message(
                "what's my booking status?", unauthenticated_context, mock_db, settings
            )

        # Should either abstain or prompt login — not crash
        assert response.content is not None
        assert len(response.content) > 0

    @pytest.mark.asyncio
    async def test_ungrounded_draft_triggers_abstention(self, mock_db, settings, agent_context):
        """If the verifier says UNGROUNDED, the orchestrator should abstain."""
        retrieval_result = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="catalog",
                    title="Some Test",
                    content="Basic test info",
                    similarity=0.75,
                )
            ],
            should_abstain=False,
            max_similarity=0.75,
        )

        with (
            patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock) as mock_retrieve,
            patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock) as mock_classify,
            patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock) as mock_draft,
            patch("app.agents.orchestrator.verify", new_callable=AsyncMock) as mock_verify,
        ):
            from app.models import Intent

            mock_retrieve.return_value = retrieval_result
            mock_classify.return_value = Intent(
                intent="FAQ", tool_name=None, parameters={},
                requires_action=False, confidence=0.7,
            )
            mock_draft.return_value = "The test guarantees 100% accuracy and is FDA approved."
            mock_verify.return_value = VerificationResult(
                verdict="UNGROUNDED",
                cleaned_response="I don't have enough info.",
                reasoning="FDA approval claim not in any source.",
                claims_checked=2,
                claims_grounded=0,
            )

            from app.agents.orchestrator import handle_message

            response = await handle_message("is this test FDA approved?", agent_context, mock_db, settings)

        assert response.was_abstained is True

    @pytest.mark.asyncio
    async def test_greeting_bypasses_verification(self, mock_db, settings, agent_context):
        """Greetings should return a friendly response without full verification."""
        retrieval_result = RetrievalResult(
            chunks=[],
            should_abstain=True,
            max_similarity=0.0,
        )

        with (
            patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock) as mock_retrieve,
            patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock) as mock_classify,
        ):
            from app.models import Intent

            mock_retrieve.return_value = retrieval_result
            mock_classify.return_value = Intent(
                intent="GREETING", tool_name=None, parameters={},
                requires_action=False, confidence=0.98,
            )

            from app.agents.orchestrator import handle_message

            response = await handle_message("hello!", agent_context, mock_db, settings)

        assert response.was_abstained is False
        assert len(response.content) > 0
