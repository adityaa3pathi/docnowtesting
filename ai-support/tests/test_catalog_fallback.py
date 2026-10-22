"""Tests for catalog tool failure fallback behavior."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch
import pytest

from app.agents.orchestrator import (
    ACTION_FAILED_RESPONSE,
    CATALOG_FAILED_RESPONSE,
    handle_message,
)
from app.models import ActionResult, Intent, RetrievalResult, RetrievedChunk, VerificationResult


@pytest.mark.asyncio
async def test_failed_catalog_search_falls_back_to_retrieved_chunks(mock_db, settings, agent_context):
    """When search_catalog fails but KB chunks are found, it generates and verifies draft from chunks."""
    chunk = RetrievedChunk(
        id="c-hba1c",
        source="catalog",
        title="HbA1c Profile",
        content="HbA1c tests average blood sugar over 2-3 months without fasting.",
        similarity=0.88,
    )
    intent = Intent(
        intent="CATALOG_SEARCH",
        tool_name="search_catalog",
        parameters={"search": "hba1c"},
        requires_action=True,
        confidence=0.9,
    )
    failed_catalog = ActionResult(tool="search_catalog", success=False, error="HTTP 429")

    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock,
              return_value=RetrievalResult(chunks=[chunk], max_similarity=0.88)) as mock_retrieve,
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock,
              return_value=intent),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock,
              return_value="HbA1c measures 3-month average glucose.") as mock_draft,
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock,
              return_value=VerificationResult(verdict="GROUNDED", cleaned_response="HbA1c measures 3-month average glucose.")),
        patch("app.agents.action.execute_action", new_callable=AsyncMock,
              return_value=failed_catalog) as mock_act,
    ):
        response = await handle_message("what is diffrence between hba1c and blood sugar fasting", agent_context, mock_db, settings)

    mock_act.assert_awaited_once()
    mock_draft.assert_awaited_once()
    # It must NOT output the booking error message
    assert response.content != ACTION_FAILED_RESPONSE
    assert "booking" not in response.content.lower()
    assert response.content == "HbA1c measures 3-month average glucose."


@pytest.mark.asyncio
async def test_failed_catalog_search_without_chunks_returns_catalog_fallback(mock_db, settings, agent_context):
    """When search_catalog fails and no KB chunks exist, it returns CATALOG_FAILED_RESPONSE, not booking error."""
    intent = Intent(
        intent="CATALOG_SEARCH",
        tool_name="search_catalog",
        parameters={"search": "unknown_test_xyz"},
        requires_action=True,
        confidence=0.9,
    )
    failed_catalog = ActionResult(tool="search_catalog", success=False, error="HTTP 429")

    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock,
              return_value=RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0)),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock,
              return_value=intent),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock) as mock_draft,
        patch("app.agents.action.execute_action", new_callable=AsyncMock,
              return_value=failed_catalog) as mock_act,
    ):
        response = await handle_message("whats the price for unknown_test_xyz", agent_context, mock_db, settings)

    mock_act.assert_awaited_once()
    mock_draft.assert_not_called()
    assert response.content == CATALOG_FAILED_RESPONSE
    assert response.content != ACTION_FAILED_RESPONSE
    assert "booking" not in response.content.lower()


@pytest.mark.asyncio
async def test_failed_booking_tool_still_returns_action_failed_response(mock_db, settings, agent_context):
    """Booking tool failure must still return ACTION_FAILED_RESPONSE."""
    intent = Intent(
        intent="BOOKING_STATUS",
        tool_name="get_booking_status",
        parameters={"booking_id": "b-123"},
        requires_action=True,
        confidence=0.9,
    )
    failed_booking = ActionResult(tool="get_booking_status", success=False, error="Not found")

    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock,
              return_value=RetrievalResult(should_abstain=True)),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock,
              return_value=intent),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock) as mock_draft,
        patch("app.agents.action.execute_action", new_callable=AsyncMock,
              return_value=failed_booking) as mock_act,
    ):
        response = await handle_message("check status of booking b-123", agent_context, mock_db, settings)

    mock_act.assert_awaited_once()
    mock_draft.assert_not_called()
    assert response.content == ACTION_FAILED_RESPONSE
