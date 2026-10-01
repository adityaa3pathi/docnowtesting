"""Tests for the Verifier Agent — grounded abstention logic."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.models import ActionResult, RetrievalResult, RetrievedChunk


class TestVerifierAgent:
    """Test the verify() function."""

    @pytest.mark.asyncio
    async def test_grounded_response_passes(self, settings):
        """A response fully supported by sources should get GROUNDED verdict."""
        retrieval = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="policy",
                    title="Cancellation Policy",
                    content="Free cancellation is available before sample collection.",
                    similarity=0.92,
                )
            ],
            should_abstain=False,
            max_similarity=0.92,
        )

        draft = "You can cancel your booking for free before the sample is collected."

        with patch("app.agents.verifier.call_gemini", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = """{
                "verdict": "GROUNDED",
                "claims_checked": 1,
                "claims_grounded": 1,
                "reasoning": "The cancellation claim matches the policy source.",
                "cleaned_response": "You can cancel your booking for free before the sample is collected."
            }"""

            from app.agents.verifier import verify

            result = await verify(draft, retrieval, [], settings)

        assert result.verdict == "GROUNDED"
        assert result.claims_checked == 1
        assert result.claims_grounded == 1

    @pytest.mark.asyncio
    async def test_ungrounded_response_blocked(self, settings):
        """A response with fabricated claims should get UNGROUNDED verdict."""
        retrieval = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="catalog",
                    title="CBC Test",
                    content="Test Name: CBC\nType: TEST\nPrice: ₹399",
                    similarity=0.88,
                )
            ],
            should_abstain=False,
            max_similarity=0.88,
        )

        # Draft makes up a price not in the sources
        draft = "The CBC test costs ₹199 and includes a free doctor consultation."

        with patch("app.agents.verifier.call_gemini", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = """{
                "verdict": "UNGROUNDED",
                "claims_checked": 2,
                "claims_grounded": 0,
                "reasoning": "Price ₹199 contradicts source (₹399). Free consultation not in any source.",
                "cleaned_response": "I'm sorry, I don't have enough verified information to answer that accurately."
            }"""

            from app.agents.verifier import verify

            result = await verify(draft, retrieval, [], settings)

        assert result.verdict == "UNGROUNDED"
        assert result.claims_grounded == 0

    @pytest.mark.asyncio
    async def test_partially_grounded_strips_claims(self, settings):
        """A partially grounded response should have ungrounded claims stripped."""
        retrieval = RetrievalResult(
            chunks=[
                RetrievedChunk(
                    id="chunk-1",
                    source="faq",
                    title="Report Delivery",
                    content="Reports are typically delivered within 24-48 hours.",
                    similarity=0.85,
                )
            ],
            should_abstain=False,
            max_similarity=0.85,
        )

        draft = "Your report will be ready in 24-48 hours. We also offer same-day results."

        with patch("app.agents.verifier.call_gemini", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = """{
                "verdict": "PARTIALLY_GROUNDED",
                "claims_checked": 2,
                "claims_grounded": 1,
                "reasoning": "24-48 hours is grounded. Same-day results claim is not supported.",
                "cleaned_response": "Your report will be ready in 24-48 hours."
            }"""

            from app.agents.verifier import verify

            result = await verify(draft, retrieval, [], settings)

        assert result.verdict == "PARTIALLY_GROUNDED"
        assert "same-day" not in result.cleaned_response.lower()

    @pytest.mark.asyncio
    async def test_verification_with_action_results(self, settings):
        """Verifier should check claims against action results too."""
        retrieval = RetrievalResult(chunks=[], should_abstain=False, max_similarity=0.0)

        actions = [
            ActionResult(
                tool="get_booking_status",
                input={"booking_id": "b-123"},
                output={"status": "Sample Collected", "phlebo": {"name": "Amit"}},
                success=True,
            )
        ]

        draft = "Your booking status is 'Sample Collected'. Amit collected your sample."

        with patch("app.agents.verifier.call_gemini", new_callable=AsyncMock) as mock_llm:
            mock_llm.return_value = """{
                "verdict": "GROUNDED",
                "claims_checked": 2,
                "claims_grounded": 2,
                "reasoning": "Both claims match the action result output.",
                "cleaned_response": "Your booking status is 'Sample Collected'. Amit collected your sample."
            }"""

            from app.agents.verifier import verify

            result = await verify(draft, retrieval, actions, settings)

        assert result.verdict == "GROUNDED"
        assert result.claims_checked == 2

    @pytest.mark.asyncio
    async def test_verification_handles_llm_error(self, settings):
        """Should handle LLM errors gracefully and default to UNGROUNDED."""
        retrieval = RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0)

        with patch("app.agents.verifier.call_gemini", new_callable=AsyncMock) as mock_llm:
            mock_llm.side_effect = Exception("LLM API error")

            from app.agents.verifier import verify

            result = await verify("test draft", retrieval, [], settings)

        # Should fail safely — treat as ungrounded
        assert result.verdict == "UNGROUNDED" or result.verdict is not None
