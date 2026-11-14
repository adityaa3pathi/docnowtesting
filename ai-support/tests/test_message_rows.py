"""asyncpg returns jsonb as text, so history showed zero sources for every message."""
from __future__ import annotations

import json

import pytest

from app.database import message_row
from app.routes.history import get_history


def test_sources_text_becomes_a_list_of_dicts():
    row = message_row({
        "id": "m1",
        "sources": json.dumps([{"id": "c1", "title": "Lipid", "source": "catalog", "similarity": 0.9}]),
        "actionsTaken": json.dumps([{"tool": "search_catalog", "success": True}]),
    })
    assert row["sources"][0]["title"] == "Lipid"
    assert row["actionsTaken"][0]["tool"] == "search_catalog"


def test_null_and_already_decoded_values_are_kept():
    assert message_row({"id": "m1", "sources": None})["sources"] is None
    assert message_row({"id": "m1", "sources": [{"id": "c1"}]})["sources"] == [{"id": "c1"}]


def test_unreadable_json_is_dropped_not_fatal():
    assert message_row({"id": "m1", "sources": "not json"})["sources"] is None


@pytest.mark.asyncio
async def test_history_reports_the_stored_sources(mock_db, settings, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    stored = [{
        "id": "m1", "role": "assistant", "content": "Lipid Profile costs ₹499.",
        "sources": json.dumps([
            {"id": "c1", "title": "Lipid Profile", "source": "catalog", "content": "body", "similarity": 0.91}
        ]),
        "actionsTaken": None, "verifierVerdict": "GROUNDED", "wasAbstained": False,
        "feedbackScore": None, "createdAt": "2026-11-08T00:00:00",
    }]
    mock_db.get_conversation_messages = AsyncMock(return_value=[message_row(m) for m in stored])
    mock_db.get_user_auth_state = AsyncMock(return_value={"status": "ACTIVE", "tokenVersion": 0})

    import app.main as main
    monkeypatch.setattr(main, "db", mock_db, raising=False)
    monkeypatch.setattr(main, "settings", settings, raising=False)

    request = MagicMock()
    request.cookies = {}
    request.headers = {}
    monkeypatch.setattr("app.routes.history.get_current_user", AsyncMock(return_value="user-1"))

    result = await get_history(request, "conv-1")

    assert len(result.messages[0].sources) == 1
    assert result.messages[0].sources[0].title == "Lipid Profile"
