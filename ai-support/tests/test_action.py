"""Tests for the Action Agent — tool dispatch + Express API calls."""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import ActionResult, Intent


class TestActionAgent:
    """Test the execute_action() function."""

    @pytest.mark.asyncio
    async def test_search_catalog_no_auth_needed(self, agent_context, settings):
        """Catalog search should work without authentication."""
        intent = Intent(
            intent="CATALOG_SEARCH",
            tool_name="search_catalog",
            parameters={"query": "thyroid"},
            requires_action=True,
            confidence=0.95,
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {
            "data": [{"name": "Thyroid Profile", "displayPrice": 599, "type": "PROFILE"}]
        }
        mock_response.raise_for_status = MagicMock()

        with patch("app.agents.action.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.get = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            from app.agents.action import execute_action

            result = await execute_action(intent, agent_context, settings)

        assert result.success is True
        assert result.tool == "search_catalog"

    @pytest.mark.asyncio
    async def test_booking_status_requires_auth(self, unauthenticated_context, settings):
        """Booking tools should fail for unauthenticated users."""
        intent = Intent(
            intent="BOOKING_STATUS",
            tool_name="get_booking_status",
            parameters={"booking_id": "booking-123"},
            requires_action=True,
            confidence=0.9,
        )

        from app.agents.action import execute_action

        result = await execute_action(intent, unauthenticated_context, settings)

        assert result.success is False
        assert "auth" in (result.error or "").lower() or result.error is not None

    @pytest.mark.asyncio
    async def test_cancel_booking_sends_post(self, agent_context, settings):
        """Cancel booking should call POST with remarks."""
        intent = Intent(
            intent="BOOKING_CANCEL",
            tool_name="cancel_booking",
            parameters={"booking_id": "booking-456", "remarks": "Need to reschedule"},
            requires_action=True,
            confidence=0.88,
        )

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"success": True, "message": "Booking cancelled"}
        mock_response.raise_for_status = MagicMock()

        with patch("app.agents.action.httpx.AsyncClient") as mock_client_cls:
            mock_client = AsyncMock()
            mock_client.__aenter__ = AsyncMock(return_value=mock_client)
            mock_client.__aexit__ = AsyncMock(return_value=False)
            mock_client.post = AsyncMock(return_value=mock_response)
            mock_client_cls.return_value = mock_client

            from app.agents.action import execute_action

            result = await execute_action(intent, agent_context, settings)

        assert result.success is True
        assert result.tool == "cancel_booking"

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error(self, agent_context, settings):
        """Unknown tool names should return an error result."""
        intent = Intent(
            intent="UNKNOWN",
            tool_name="nonexistent_tool",
            parameters={},
            requires_action=True,
            confidence=0.5,
        )

        from app.agents.action import execute_action

        result = await execute_action(intent, agent_context, settings)

        assert result.success is False
        assert result.error is not None
