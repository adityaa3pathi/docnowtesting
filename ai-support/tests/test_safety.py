"""Safety rules: writes need a "yes", tool inputs are checked, pending actions live server-side."""
from __future__ import annotations

from unittest.mock import AsyncMock, patch

import pytest

from app.models import ActionResult, Intent, RetrievalResult, VerificationResult

CANCEL = Intent(
    intent="BOOKING_CANCEL",
    tool_name="cancel_booking",
    parameters={"booking_id": "B123"},
    requires_action=True,
    confidence=0.9,
)


def _pipeline_patches():
    return (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock, return_value=RetrievalResult()),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock),
        patch("app.agents.action.execute_action", new_callable=AsyncMock),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value="Cancelled."),
        patch(
            "app.agents.orchestrator.verify",
            new_callable=AsyncMock,
            return_value=VerificationResult(verdict="GROUNDED", cleaned_response="Cancelled."),
        ),
    )


@pytest.mark.asyncio
async def test_write_tool_asks_before_running(mock_db, settings, agent_context):
    from app.agents.orchestrator import handle_message

    p_retrieve, p_classify, p_exec, p_draft, p_verify = _pipeline_patches()
    with p_retrieve, p_classify as classify, p_exec as execute, p_draft, p_verify:
        classify.return_value = CANCEL
        response = await handle_message("cancel booking B123", agent_context, mock_db, settings)

    execute.assert_not_called()
    assert response.pending_action == CANCEL
    assert "YES" in response.content


@pytest.mark.asyncio
async def test_yes_runs_the_pending_write(mock_db, settings, agent_context):
    from app.agents.orchestrator import handle_message

    agent_context.pending_action = CANCEL
    p_retrieve, p_classify, p_exec, p_draft, p_verify = _pipeline_patches()
    with p_retrieve, p_classify as classify, p_exec as execute, p_draft, p_verify:
        execute.return_value = ActionResult(tool="cancel_booking", success=True, output={"ok": True})
        response = await handle_message("Yes please", agent_context, mock_db, settings)

    classify.assert_not_called()
    execute.assert_called_once()
    assert response.pending_action is None
    assert response.actions_taken[0].tool == "cancel_booking"


@pytest.mark.asyncio
async def test_anything_but_yes_drops_the_pending_write(mock_db, settings, agent_context):
    from app.agents.orchestrator import handle_message

    agent_context.pending_action = CANCEL
    p_retrieve, p_classify, p_exec, p_draft, p_verify = _pipeline_patches()
    with p_retrieve, p_classify as classify, p_exec as execute, p_draft, p_verify:
        classify.return_value = Intent(intent="FAQ", requires_action=False)
        await handle_message("yes, but what is the refund policy?", agent_context, mock_db, settings)

    classify.assert_called_once()
    execute.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize("booking_id", ["../admin/users", "B1/cancel", "B1?x=1", ""])
async def test_path_values_must_look_like_ids(agent_context, settings, booking_id):
    from app.agents.action import execute_action

    intent = Intent(intent="BOOKING_STATUS", tool_name="get_booking_status", parameters={"booking_id": booking_id})
    with patch("app.agents.action.httpx.AsyncClient") as client:
        result = await execute_action(intent, agent_context, settings)

    client.assert_not_called()
    assert result.success is False


def test_pending_action_is_read_from_last_assistant_message():
    from app.routes.chat import _pending_action

    stored = '[{"pending": {"intent": "BOOKING_CANCEL", "tool_name": "cancel_booking", "parameters": {"booking_id": "B123"}}}]'
    messages = [
        {"role": "user", "content": "cancel B123"},
        {"role": "assistant", "content": "Please confirm", "actionsTaken": stored},
    ]
    assert _pending_action(messages).tool_name == "cancel_booking"

    messages.append({"role": "assistant", "content": "Anything else?", "actionsTaken": None})
    assert _pending_action(messages) is None
