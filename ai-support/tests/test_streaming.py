"""Phase 5: POST /api/support/chat/stream (SSE). Transport only: same turn, status events, one final event."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from contextlib import asynccontextmanager, contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.agents import orchestrator, usage
from app.agents.orchestrator import STATUSES, TurnEvents
from app.models import (
    ActionResult,
    AgentContext,
    Intent,
    RetrievalResult,
    RetrievedChunk,
    VerificationResult,
)
from app.prompts.verifier import ABSTENTION_MESSAGE
from app.routes.chat import _stream_turn, _Turn

DRAFT = "UNVERIFIED-DRAFT: fasting is 12 hours and home collection is at your doorstep."
CLEAN = "Fasting is 12 hours."
CHUNKS = [RetrievedChunk(id="c1", source="faq", title="Fasting", content="Fasting: 12 hours.", similarity=0.9)]
FAQ = Intent(intent="FAQ", confidence=0.9)
PENDING = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", parameters={"booking_id": "b1"},
                 requires_action=True, confidence=0.9)


def parse_sse(text: str) -> list[tuple[str, dict]]:
    """(event, data) pairs from an SSE body; comments (keep-alives) are skipped."""
    events = []
    for block in text.split("\n\n"):
        lines = [ln for ln in block.split("\n") if ln and not ln.startswith(":")]
        if not lines:
            continue
        fields = dict(ln.split(": ", 1) for ln in lines)
        events.append((fields["event"], json.loads(fields["data"])))
    return events


@pytest.fixture(autouse=True)
def _fresh_threads():
    orchestrator._PAUSED.clear()
    yield
    for thread in list(orchestrator._PAUSED):
        orchestrator._forget_now(thread)


@contextmanager
def pipeline(*, verdict="PARTIALLY_GROUNDED", cleaned=CLEAN, intent=FAQ, retrieval=None, timeline=None,
             draft_delay=0.0, classify_delay=0.0, search_delay=0.0, execute=None):
    """Patched pipeline; `timeline` records when the verifier returned, relative to events seen."""
    seen = SimpleNamespace(draft_cancelled=False, search_cancelled=False, classify_cancelled=False,
                           verify_calls=0, writes=[])

    async def classify(*_a, **_k):
        try:
            await asyncio.sleep(classify_delay)
        except asyncio.CancelledError:
            seen.classify_cancelled = True
            raise
        usage.record(usage.CallUsage(stage="intent", model="m", prompt_tokens=100, output_tokens=10))
        return intent

    async def search(*_a, **_k):
        try:
            await asyncio.sleep(search_delay)
        except asyncio.CancelledError:
            seen.search_cancelled = True
            raise
        return retrieval or RetrievalResult(chunks=CHUNKS, max_similarity=0.9)

    async def draft(*_a, **_k):
        try:
            await asyncio.sleep(draft_delay)
        except asyncio.CancelledError:
            seen.draft_cancelled = True
            raise
        usage.record(usage.CallUsage(stage="draft", model="m", prompt_tokens=200, output_tokens=20))
        return DRAFT

    async def verify(*_a, **_k):
        seen.verify_calls += 1
        if timeline is not None:
            timeline.append(("VERDICT", verdict))
        return VerificationResult(verdict=verdict, cleaned_response=DRAFT if cleaned is None else cleaned)

    async def default_execute(intent, _ctx, _settings):
        if intent.tool_name in ("cancel_booking", "reschedule_booking"):
            await asyncio.sleep(0.3)  # the Express write is in flight
            seen.writes.append(intent.parameters.get("booking_id"))
        return ActionResult(tool=intent.tool_name, success=True, output={"status": "Cancelled"})

    with (
        patch("app.agents.orchestrator.retrieve", side_effect=search),
        patch("app.agents.orchestrator.classify_intent", side_effect=classify),
        patch("app.agents.orchestrator.generate_draft", side_effect=draft),
        patch("app.agents.orchestrator.verify", side_effect=verify),
        patch("app.agents.orchestrator.live_cards_for_chunks", new_callable=AsyncMock, return_value=[]),
        patch("app.agents.action.execute_action", side_effect=execute or default_execute),
    ):
        yield seen


def _turn(message="Do I need to fast?", conversation_id="ephemeral", user_id=None, pending=None) -> _Turn:
    return _Turn(message, user_id, None, conversation_id, [], pending, time.monotonic())


async def _events(turn, mock_db, settings, timeline=None) -> list[tuple[str, dict]]:
    out = []
    async for raw in _stream_turn(turn, mock_db, settings):
        for event in parse_sse(raw):
            out.append(event)
            if timeline is not None:
                timeline.append(("EVENT", event))
    return out


# ── The hard rule: no draft or unverified text in any event ──────────────


@pytest.mark.asyncio
@pytest.mark.parametrize("verdict,cleaned,shown", [
    ("GROUNDED", None, DRAFT),                      # verified as written: the draft text IS the answer, after the verdict
    ("PARTIALLY_GROUNDED", CLEAN, CLEAN),           # only the verifier's cleaned text goes out
    ("UNGROUNDED", "", ABSTENTION_MESSAGE),         # blocked: the draft never goes out at all
])
async def test_no_draft_text_in_any_event_before_the_verdict(mock_db, settings, verdict, cleaned, shown):
    timeline: list = []
    with pipeline(verdict=verdict, cleaned=cleaned, timeline=timeline):
        events = await _events(_turn(), mock_db, settings, timeline)

    verdict_at = timeline.index(("VERDICT", verdict))
    for i, entry in enumerate(timeline):
        if entry[0] != "EVENT":
            continue
        kind, data = entry[1]
        text = json.dumps(data)
        assert "UNVERIFIED-DRAFT" not in text or (kind == "final" and i > verdict_at and verdict == "GROUNDED"), entry
        assert "doorstep" not in text or verdict == "GROUNDED", entry
        if kind == "status":
            assert set(data) == {"stage"} and data["stage"] in STATUSES  # a status carries no text
        if kind != "final":
            assert "content" not in data
    finals = [d for k, d in events if k == "final"]
    assert len(finals) == 1 and events[-1][0] == "final"
    assert timeline.index(("EVENT", events[-1])) > verdict_at  # the answer leaves only after the verdict
    assert finals[0]["content"] == shown


@pytest.mark.asyncio
async def test_status_events_follow_the_graph(mock_db, settings):
    with pipeline():
        events = await _events(_turn(), mock_db, settings)
    assert [k for k, _ in events] == ["start", "status", "status", "status", "final"]
    assert [d["stage"] for k, d in events if k == "status"] == ["searching", "drafting", "verifying"]
    assert events[0][1] == {"conversation_id": "ephemeral"}


@pytest.mark.asyncio
async def test_greeting_streams_only_the_final_event(mock_db, settings):
    with pipeline():
        events = await _events(_turn("hi"), mock_db, settings)
    assert [k for k, _ in events] == ["start", "final"]


@pytest.mark.asyncio
async def test_abstention_has_no_draft_status(mock_db, settings):
    with pipeline(retrieval=RetrievalResult(should_abstain=True)) as seen:
        events = await _events(_turn(), mock_db, settings)
    assert [d["stage"] for k, d in events if k == "status"] == ["searching"]
    assert events[-1][1]["content"] == ABSTENTION_MESSAGE and events[-1][1]["was_abstained"]
    assert seen.verify_calls == 0


@pytest.mark.asyncio
async def test_status_values_are_only_known_stages():
    seen: list[str] = []
    events = TurnEvents(on_status=seen.append)
    for stage in ["searching", "searching", "drafting", "verifying", "verifying"]:
        events.status(stage)
    assert seen == ["searching", "drafting", "verifying"]  # each status once


# ── Interrupt questions are the final event; durability and pausing unchanged ──


def _logged_in(conv: str) -> _Turn:
    return _turn("I want to cancel my booking", conversation_id=conv, user_id="u1")


@pytest.mark.asyncio
async def test_slot_filling_question_is_the_final_event_and_the_thread_pauses(mock_db, settings):
    bookings = [{"id": "1", "status": "Order Booked", "items": [{"testName": "CBC"}]},
                {"id": "2", "status": "Order Booked", "items": [{"testName": "Lipid"}]}]

    async def execute(intent, _ctx, _settings):
        return ActionResult(tool=intent.tool_name, success=True, output={"bookings": bookings})

    conv = f"c-{uuid.uuid4()}"
    cancel = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", requires_action=True, confidence=0.9)
    with pipeline(intent=cancel, execute=execute):
        events = await _events(_logged_in(conv), mock_db, settings)
    final = events[-1][1]
    assert [d["stage"] for k, d in events if k == "status"] == ["searching", "checking_bookings"]
    assert final["content"].startswith("Which booking do you want to cancel?")
    assert final["pending_action"] == {"tool": "cancel_booking", "parameters": {}}
    assert f"conversation:{conv}" in orchestrator._PAUSED  # paused exactly as on the JSON route


# ── Same answer and stored row as POST /chat ─────────────────────────────


@asynccontextmanager
async def asgi_client(settings, mock_db, user_id=None):
    from app import main

    with patch.object(main, "settings", settings), patch.object(main, "db", mock_db), \
            patch("app.routes.chat.get_current_user", new_callable=AsyncMock, return_value=user_id):
        transport = httpx.ASGITransport(app=main.app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            yield client


@pytest.mark.asyncio
async def test_final_event_is_the_json_body_and_the_same_row_is_stored(mock_db, settings):
    mock_db.get_recent_messages = AsyncMock(return_value=[])
    bodies, stored = [], []
    for path in ("/api/support/chat", "/api/support/chat/stream"):
        mock_db.add_message.reset_mock()
        with pipeline(), patch("app.agents.orchestrator.current_trace_id", return_value="trace-1"):
            async with asgi_client(settings, mock_db, user_id="u1") as client:
                r = await client.post(path, json={"message": "Do I need to fast?", "conversation_id": "conv-1"})
        assert r.status_code == 200
        if path.endswith("stream"):
            assert r.headers["content-type"].startswith("text/event-stream")
            assert r.headers["cache-control"] == "no-cache, no-transform"
            assert r.headers["x-accel-buffering"] == "no"
            final = parse_sse(r.text)[-1]
            assert final[0] == "final" and final[1].pop("pending_action") is None
            bodies.append(final[1])
        else:
            bodies.append(r.json())
        row = mock_db.add_message.await_args_list[-1].kwargs
        row.pop("latency_ms")
        stored.append(row)
    assert bodies[0] == bodies[1]
    assert stored[0] == stored[1]
    assert stored[1]["role"] == "assistant" and stored[1]["content"] == CLEAN
    assert stored[1]["token_count"] == 330  # usage tracking survives streaming (intent 110 + draft 220)
    assert stored[1]["langfuse_trace_id"] == "trace-1"


@pytest.mark.asyncio
async def test_turn_cap_is_a_plain_http_error_before_streaming(mock_db, settings):
    mock_db.count_user_messages = AsyncMock(return_value=settings.max_conversation_turns)
    with pipeline():
        async with asgi_client(settings, mock_db, user_id="u1") as client:
            r = await client.post("/api/support/chat/stream", json={"message": "hi", "conversation_id": "conv-1"})
    assert r.status_code == 400 and "maximum number of turns" in r.json()["detail"]


@pytest.mark.asyncio
async def test_failed_store_is_an_error_event(mock_db, settings):
    mock_db.add_message = AsyncMock(side_effect=RuntimeError("db down"))  # storing the reply fails
    with pipeline():
        events = await _events(_turn(conversation_id="conv-1", user_id="u1"), mock_db, settings)
    assert events[-1] == ("error", {"detail": "An error occurred processing your request"})


# ── Disconnects, against a real server (proves nothing buffers and cancellation is real) ──


@asynccontextmanager
async def live_server(settings, mock_db, user_id=None):
    import uvicorn

    from app import main

    settings.proxy_secret = "s3cret"  # the proxy-secret middleware stays in the path
    with patch.object(main, "settings", settings), patch.object(main, "db", mock_db), \
            patch("app.routes.chat.get_current_user", new_callable=AsyncMock, return_value=user_id):
        server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=0, lifespan="off", log_level="warning"))
        task = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        try:
            async with httpx.AsyncClient(base_url=f"http://127.0.0.1:{port}", timeout=10,
                                         headers={"x-docnow-support-proxy": "s3cret"}) as client:
                yield client
        finally:
            server.should_exit = True
            await task


async def _read_until(client, body, stop_at: str | None):
    """Stream events; return (event, seconds since request) pairs, hanging up after `stop_at`."""
    got, t0 = [], time.monotonic()
    async with client.stream("POST", "/api/support/chat/stream", json=body) as r:
        assert r.status_code == 200
        buffer = ""
        async for chunk in r.aiter_text():
            buffer += chunk
            while "\n\n" in buffer:
                block, buffer = buffer.split("\n\n", 1)
                for event in parse_sse(block + "\n\n"):
                    got.append((event, time.monotonic() - t0))
                    if stop_at and event[0] == "status" and event[1]["stage"] == stop_at:
                        return got  # leaving the block closes the connection mid-turn
    return got


async def _until(predicate, timeout=3.0):
    deadline = time.monotonic() + timeout
    while not predicate():
        assert time.monotonic() < deadline, "timed out"
        await asyncio.sleep(0.02)


@pytest.mark.asyncio
async def test_events_arrive_while_the_turn_runs(mock_db, settings):
    with pipeline(draft_delay=0.6):
        async with live_server(settings, mock_db) as client:
            got = await _read_until(client, {"message": "Do I need to fast?"}, None)
    at = {e[0] if e[0] != "status" else e[1]["stage"]: t for e, t in got}
    assert at["drafting"] < 0.3 and at["final"] >= 0.6  # not buffered until the end


@pytest.mark.asyncio
async def test_disconnect_while_searching_cancels_intent_and_search(mock_db, settings):
    with pipeline(classify_delay=5, search_delay=5) as seen:
        async with live_server(settings, mock_db) as client:
            await _read_until(client, {"message": "Do I need to fast?"}, "searching")
            await _until(lambda: seen.classify_cancelled and seen.search_cancelled)
    assert seen.verify_calls == 0


@pytest.mark.asyncio
async def test_disconnect_while_drafting_cancels_the_turn_and_stores_nothing(mock_db, settings):
    mock_db.get_recent_messages = AsyncMock(return_value=[])
    with pipeline(draft_delay=5) as seen:
        async with live_server(settings, mock_db, user_id="u1") as client:
            await _read_until(client, {"message": "Do I need to fast?", "conversation_id": "conv-1"}, "drafting")
            await _until(lambda: seen.draft_cancelled)
            await asyncio.sleep(0.1)
    assert seen.verify_calls == 0
    assert [c.kwargs["role"] for c in mock_db.add_message.await_args_list] == ["user"]  # no reply row


@pytest.mark.asyncio
async def test_a_write_in_flight_finishes_and_is_stored_after_a_disconnect(mock_db, settings):
    confirm = {"role": "assistant", "content": "Reply YES to cancel booking b1.",
               "actionsTaken": [{"pending": PENDING.model_dump()}]}
    mock_db.get_recent_messages = AsyncMock(return_value=[{"role": "user", "content": "cancel b1"}, confirm])
    with pipeline() as seen:
        async with live_server(settings, mock_db, user_id="u1") as client:
            await _read_until(client, {"message": "yes", "conversation_id": "conv-1"}, "updating_booking")
            await _until(lambda: any(c.kwargs["role"] == "assistant" for c in mock_db.add_message.await_args_list))
    assert seen.writes == ["b1"]  # ran once
    reply = [c.kwargs for c in mock_db.add_message.await_args_list if c.kwargs["role"] == "assistant"][0]
    assert reply["actions_taken"][0]["tool"] == "cancel_booking" and reply["actions_taken"][0]["success"]
    assert not any("pending" in a for a in reply["actions_taken"])  # the stored history no longer asks for a yes


@pytest.mark.asyncio
async def test_a_cancelled_run_is_never_resumed_into_a_write(mock_db, settings):
    """LangGraph (durability="exit") checkpoints a cancelled run at the next node. Without dropping that
    thread, the customer's next message would resume it at `action` and cancel the booking with no yes."""
    ctx = AgentContext(user_id="u1", is_authenticated=True, access_token="t", conversation_id=f"c-{uuid.uuid4()}")
    with pipeline(intent=PENDING) as seen:
        first = await orchestrator.handle_message("cancel booking b1", ctx, mock_db, settings)
        assert "Reply YES" in first.content
        ctx.pending_action = first.pending_action

        holder = {}

        def cancel_before_the_write(stage):  # the cancel lands between confirm and the write
            if stage == "updating_booking":
                holder["task"].cancel()

        events = TurnEvents(on_status=cancel_before_the_write)
        holder["task"] = asyncio.create_task(orchestrator.handle_message("yes", ctx, mock_db, settings, events=events))
        with pytest.raises(asyncio.CancelledError):
            await holder["task"]
        assert not events.write_started and seen.writes == []

        # The stored history still shows the confirm question; the next message is not a yes.
        later = await orchestrator.handle_message("hello?", ctx, mock_db, settings)
    assert seen.writes == []
    assert later.actions_taken == [] or all(a.tool != "cancel_booking" for a in later.actions_taken)


@pytest.mark.asyncio
async def test_invoke_returns_what_ainvoke_returns(mock_db, settings):
    """The JSON route now runs the graph through astream; its result must equal ainvoke's."""
    bookings = [{"id": "1", "status": "Order Booked", "items": [{"testName": "CBC"}]},
                {"id": "2", "status": "Order Booked", "items": [{"testName": "Lipid"}]}]

    async def execute(intent, _ctx, _settings):
        return ActionResult(tool=intent.tool_name, success=True, output={"bookings": bookings})

    cancel = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking", requires_action=True, confidence=0.9)
    for intent, message in ((FAQ, "Do I need to fast?"), (cancel, "cancel my booking")):
        with pipeline(intent=intent, execute=execute):
            ctx = AgentContext(user_id="u1", is_authenticated=True, access_token="t", conversation_id="x")
            deps = orchestrator.TurnDeps(ctx=ctx, db=mock_db, settings=settings)
            ours = await orchestrator._invoke({"message": message}, f"a-{uuid.uuid4()}", deps)
            deps = orchestrator.TurnDeps(ctx=ctx, db=mock_db, settings=settings)
            theirs = await orchestrator.SUPPORT_GRAPH.ainvoke(
                {"message": message}, {"configurable": {"thread_id": f"b-{uuid.uuid4()}"}}, context=deps,
                durability="exit")
        assert ours.keys() == theirs.keys()
        if "__interrupt__" in ours:
            assert [i.value for i in ours.pop("__interrupt__")] == [i.value for i in theirs.pop("__interrupt__")]
        assert ours == theirs


def test_stream_bench_summary_per_route():
    from app.eval.stream_bench import summarize

    rows = []
    for rnd in range(2):
        for i in range(4):
            rows.append({"round": rnd, "transport": "json", "final_ms": 3000 + 100 * i, "probe_ok": True})
            rows.append({"round": rnd, "transport": "sse", "first_byte_ms": 5, "start_ms": 5, "first_status_ms": 20 + i,
                         "final_ms": 3010 + 100 * i, "probe_ok": i != 3})
    rows.append({"round": 0, "transport": "sse", "error": "boom"})
    s = summarize(rows)
    assert s["json final"]["p50"] == (3200, 0) and s["sse final"]["p50"] == (3210, 0)
    assert s["sse first status"]["p95"] == (23, 0)
    assert s["json probe_pass"] == 1.0 and s["sse probe_pass"] == 0.75
    assert s["sse errors"] == 1 and s["json errors"] == 0
