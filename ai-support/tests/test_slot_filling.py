"""Phase 3: cancel/reschedule without a booking ID (list → pick → confirm → write, with interrupt())."""
from __future__ import annotations

import uuid
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from app.agents import orchestrator
from app.agents.orchestrator import NO_OPEN_BOOKINGS_RESPONSE, _pick_booking, handle_message
from app.models import ActionResult, AgentContext, Intent, RetrievalResult, VerificationResult

OPEN = [
    {"id": "12345", "status": "Sample Collector Assigned", "items": [{"testName": "Complete Blood Count (CBC)"}],
     "slotDate": "2026-11-23", "slotTime": "09:00"},
    {"id": "98765", "status": "Order Booked", "items": [{"testName": "Lipid Profile"}],
     "slotDate": "2026-11-28", "slotTime": "08:00"},
]
CLOSED = [{"id": "55501", "status": "Cancelled", "items": [{"testName": "Thyroid Profile"}]}]
WRITES = ("cancel_booking", "reschedule_booking")


@contextmanager
def flow(bookings, intent=None):
    """Fake Express through execute_action; records every tool call."""
    calls: list[Intent] = []

    async def execute(intent: Intent, _ctx, _settings):
        calls.append(intent)
        if intent.tool_name == "list_bookings":
            return ActionResult(tool="list_bookings", success=True, output={"bookings": bookings})
        if intent.tool_name in WRITES and not intent.parameters.get("booking_id"):
            return ActionResult(tool=intent.tool_name, success=False, error="Missing required parameter(s)")
        return ActionResult(tool=intent.tool_name, success=True, output={"status": "Cancelled"})

    classify = AsyncMock(return_value=intent or Intent(
        intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={}, requires_action=True, confidence=0.9))
    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock, return_value=RetrievalResult()),
        patch("app.agents.orchestrator.classify_intent", classify),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value="Your booking is cancelled."),
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock,
              return_value=VerificationResult(verdict="GROUNDED", cleaned_response="Reports take a day.")),
        patch("app.agents.action.execute_action", side_effect=execute),
    ):
        yield SimpleNamespace(calls=calls, classify=classify)


def _ctx() -> AgentContext:
    return AgentContext(user_id="u1", is_authenticated=True, access_token="t", conversation_id=f"c-{uuid.uuid4()}")


async def _turn(message, ctx, mock_db, settings):
    """One chat turn, carrying history and the pending write the way the chat route does."""
    resp = await handle_message(message, ctx, mock_db, settings)
    ctx.conversation_history += [{"role": "user", "content": message}, {"role": "assistant", "content": resp.content}]
    ctx.pending_action = resp.pending_action
    return resp


def _assert_no_write_without_id(responses, calls):
    for r in responses:
        if "Reply YES" in r.content:
            assert r.pending_action.parameters.get("booking_id"), r.content
    assert not [c for c in calls if c.tool_name in WRITES and not c.parameters.get("booking_id")]


@pytest.mark.asyncio
async def test_cancel_without_id_lists_bookings_then_confirms_then_writes(mock_db, settings):
    ctx = _ctx()
    with flow(OPEN + CLOSED) as f:
        r1 = await _turn("I want to cancel my booking", ctx, mock_db, settings)
        r2 = await _turn("the lipid profile one", ctx, mock_db, settings)
        r3 = await _turn("yes", ctx, mock_db, settings)
    assert r1.content.startswith("Which booking do you want to cancel?")
    assert "55501" not in r1.content  # cancelled bookings are not offered
    assert r1.pending_action.tool_name == "cancel_booking" and not r1.pending_action.parameters.get("booking_id")
    assert [a.tool for a in r1.actions_taken] == ["list_bookings"]
    assert "Reply YES" in r2.content and "98765" in r2.content and "Lipid Profile" in r2.content
    assert r3.verifier_verdict == "TOOL_ONLY" and r3.pending_action is None
    assert [a.tool for a in r3.actions_taken] == ["cancel_booking"]
    assert [(c.tool_name, c.parameters.get("booking_id")) for c in f.calls] == [
        ("list_bookings", None), ("cancel_booking", "98765")]
    assert f.classify.await_count == 1  # the answers resume the graph; no new classification
    _assert_no_write_without_id([r1, r2, r3], f.calls)


@pytest.mark.asyncio
async def test_single_open_booking_goes_straight_to_confirm(mock_db, settings):
    ctx = _ctx()
    with flow([OPEN[1]] + CLOSED) as f:
        r1 = await _turn("cancel my booking", ctx, mock_db, settings)
    assert "Reply YES" in r1.content and r1.pending_action.parameters["booking_id"] == "98765"
    _assert_no_write_without_id([r1], f.calls)


@pytest.mark.asyncio
async def test_no_open_booking_says_so_and_writes_nothing(mock_db, settings):
    ctx = _ctx()
    with flow(CLOSED) as f:
        r1 = await _turn("cancel my booking", ctx, mock_db, settings)
    assert r1.content == NO_OPEN_BOOKINGS_RESPONSE and r1.pending_action is None
    assert [c.tool_name for c in f.calls] == ["list_bookings"]


@pytest.mark.asyncio
async def test_a_non_answer_drops_the_pending_write_and_is_handled_afresh(mock_db, settings):
    ctx = _ctx()
    with flow(OPEN) as f:
        await _turn("cancel my booking", ctx, mock_db, settings)
        f.classify.return_value = Intent(intent="FAQ", confidence=0.9)
        r2 = await _turn("how long do reports take?", ctx, mock_db, settings)
    assert f.classify.await_count == 2
    assert r2.pending_action is None and "Reply YES" not in r2.content
    _assert_no_write_without_id([r2], f.calls)


@pytest.mark.asyncio
async def test_no_to_the_confirmation_writes_nothing(mock_db, settings):
    ctx = _ctx()
    with flow([OPEN[1]]) as f:
        await _turn("cancel my booking", ctx, mock_db, settings)
        f.classify.return_value = Intent(intent="FAQ", confidence=0.9)
        await _turn("no wait", ctx, mock_db, settings)
    assert not [c for c in f.calls if c.tool_name in WRITES]


@pytest.mark.asyncio
async def test_lost_pause_never_writes_without_an_id(mock_db, settings):
    """After a restart the pause is gone; a stored pending write without an ID plus "yes" asks again."""
    ctx = _ctx()
    ctx.pending_action = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={}, requires_action=True)
    with flow(OPEN) as f:
        r = await _turn("yes", ctx, mock_db, settings)
    assert r.content.startswith("Which booking")
    _assert_no_write_without_id([r], f.calls)


@pytest.mark.asyncio
async def test_lost_pause_with_an_id_still_confirms_through_the_stored_pending_action(mock_db, settings):
    ctx = _ctx()
    ctx.pending_action = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking",
                                parameters={"booking_id": "98765"}, requires_action=True)
    with flow(OPEN) as f:
        r = await _turn("yes", ctx, mock_db, settings)
    assert [(c.tool_name, c.parameters["booking_id"]) for c in f.calls] == [("cancel_booking", "98765")]
    assert r.verifier_verdict == "TOOL_ONLY"


@pytest.mark.asyncio
async def test_a_choice_made_after_an_early_yes_is_still_confirmed(mock_db, settings):
    """A "yes" to an ID-less prompt from before a restart does not cover the booking picked afterwards."""
    ctx = _ctx()
    ctx.pending_action = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={}, requires_action=True)
    with flow(OPEN) as f:
        await _turn("yes", ctx, mock_db, settings)
        r2 = await _turn("2", ctx, mock_db, settings)
    assert "Reply YES" in r2.content and r2.pending_action.parameters["booking_id"] == "98765"
    assert not [c for c in f.calls if c.tool_name in WRITES]


@pytest.mark.asyncio
async def test_with_an_id_the_old_confirm_flow_is_unchanged(mock_db, settings):
    ctx = _ctx()
    intent = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={"booking_id": "98765"},
                    requires_action=True)
    with flow(OPEN, intent=intent) as f:
        r1 = await _turn("cancel booking 98765", ctx, mock_db, settings)
        r2 = await _turn("yes", ctx, mock_db, settings)
    assert r1.content == orchestrator._confirmation_request(intent)
    assert [c.tool_name for c in f.calls] == ["cancel_booking"]
    assert r2.verifier_verdict == "TOOL_ONLY"


@pytest.mark.asyncio
async def test_confirm_node_refuses_a_write_without_booking_id():
    state = {"intent": Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={}), "confirmed": False}
    with pytest.raises(ValueError):
        await orchestrator.confirm_node(state)


@pytest.mark.asyncio
async def test_finished_turns_leave_no_checkpoint(mock_db, settings):
    ctx = _ctx()
    with flow(OPEN):
        await _turn("cancel my booking", ctx, mock_db, settings)
        assert f"conversation:{ctx.conversation_id}" in orchestrator._PAUSED
        await _turn("2", ctx, mock_db, settings)
        await _turn("yes", ctx, mock_db, settings)
    thread = f"conversation:{ctx.conversation_id}"
    assert thread not in orchestrator._PAUSED
    state = await orchestrator.SUPPORT_GRAPH.aget_state({"configurable": {"thread_id": thread}})
    assert state.values == {}


@pytest.mark.parametrize("answer,expected", [
    ("98765", "98765"), ("booking 12345 please", "12345"), ("2", "98765"), ("the first one", "12345"),
    ("second", "98765"), ("the lipid profile one", "98765"), ("CBC", "12345"), ("2026-11-28", "98765"),
    ("yes", None), ("how long do reports take", None), ("7", None), ("no wait", None),
])
def test_pick_booking(answer, expected):
    assert _pick_booking(answer, OPEN) == expected


@pytest.mark.asyncio
async def test_reschedule_without_a_slot_points_to_the_app_instead_of_asking_yes(mock_db, settings):
    ctx = _ctx()
    intent = Intent(intent="RESCHEDULE", tool_name="reschedule_booking", parameters={}, requires_action=True)
    with flow(OPEN, intent=intent) as f:
        r1 = await _turn("reschedule my appointment", ctx, mock_db, settings)
        r2 = await _turn("2", ctx, mock_db, settings)
    assert r1.content.startswith("Which booking do you want to reschedule?")
    assert "Reply YES" not in r2.content and "My Bookings" in r2.content and "Lipid Profile" in r2.content
    assert r2.pending_action is None
    assert not [c for c in f.calls if c.tool_name in WRITES]


@pytest.mark.asyncio
async def test_confirm_names_the_picked_booking_once(mock_db, settings):
    ctx = _ctx()
    with flow([OPEN[1]]):
        r1 = await _turn("cancel my booking", ctx, mock_db, settings)
    assert r1.content.count("98765") == 1 and "Lipid Profile" in r1.content
