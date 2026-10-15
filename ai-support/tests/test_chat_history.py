"""Short-term history uses the latest messages and keeps the turn cap working (U3)."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.routes.chat import HISTORY_MESSAGES, load_turn_state


def _msg(role: str, content: str, actions=None) -> dict:
    return {"role": role, "content": content, "actionsTaken": actions}


@pytest.mark.asyncio
async def test_history_comes_from_the_latest_messages(mock_db, settings):
    recent = [_msg("user", f"u{i}") if i % 2 == 0 else _msg("assistant", f"a{i}") for i in range(24, 30)]
    mock_db.get_recent_messages = AsyncMock(return_value=recent)
    mock_db.count_user_messages = AsyncMock(return_value=3)

    history, pending = await load_turn_state(mock_db, "conv-1", settings)

    mock_db.get_recent_messages.assert_awaited_once_with("conv-1", limit=HISTORY_MESSAGES)
    assert [m["content"] for m in history] == ["u24", "a25", "u26", "a27", "u28", "a29"]
    assert pending is None


@pytest.mark.asyncio
async def test_pending_action_is_found_in_a_long_conversation(mock_db, settings):
    pending = {"intent": "BOOKING_CANCEL", "tool_name": "cancel_booking",
               "parameters": {"booking_id": "b1"}, "requires_action": True, "confidence": 0.9}
    recent = [_msg("user", "cancel b1"), _msg("assistant", "Please confirm", json.dumps([{"pending": pending}]))]
    mock_db.get_recent_messages = AsyncMock(return_value=recent)
    mock_db.count_user_messages = AsyncMock(return_value=8)

    _, found = await load_turn_state(mock_db, "conv-1", settings)

    assert found is not None and found.tool_name == "cancel_booking"


@pytest.mark.asyncio
async def test_turn_cap_counts_all_user_messages_not_just_recent(mock_db, settings):
    mock_db.get_recent_messages = AsyncMock(return_value=[_msg("user", "hi")])
    mock_db.count_user_messages = AsyncMock(return_value=12)

    with pytest.raises(HTTPException) as err:
        await load_turn_state(mock_db, "conv-1", settings)
    assert err.value.status_code == 400
