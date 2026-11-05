"""Phase 2 (U4): fewer LLM calls and tokens per turn."""
from __future__ import annotations

from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from google.genai import types

from app.agents.orchestrator import compact_tool_output, handle_message
from app.models import ActionResult, Intent, RetrievalResult, RetrievedChunk, VerificationResult
from app.prompts.verifier import ABSTENTION_MESSAGE

CHUNK = RetrievedChunk(id="c1", source="faq", title="Fasting", content="Fast 10-12 hours.", similarity=0.9)


@contextmanager
def pipeline(retrieval=None, intent=None, draft="Draft.", verdict="GROUNDED", action=None):
    with (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock,
              return_value=retrieval or RetrievalResult(chunks=[CHUNK], max_similarity=0.9)) as retrieve,
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock,
              return_value=intent or Intent(intent="FAQ", confidence=0.9)) as classify,
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value=draft) as gen,
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock,
              return_value=VerificationResult(verdict=verdict, cleaned_response=draft)) as ver,
        patch("app.agents.action.execute_action", new_callable=AsyncMock,
              return_value=action or ActionResult(tool="list_bookings", success=True, output={"bookings": []})) as act,
    ):
        yield SimpleNamespace(retrieve=retrieve, classify=classify, draft=gen, verify=ver, action=act)


@pytest.mark.asyncio
@pytest.mark.parametrize("text", ["hi", "Hello!", "namaste", "thanks"])
async def test_greeting_makes_no_model_or_search_call(mock_db, settings, agent_context, text):
    with pipeline() as p:
        response = await handle_message(text, agent_context, mock_db, settings)
    p.retrieve.assert_not_called()
    p.classify.assert_not_called()
    assert not response.was_abstained


@pytest.mark.asyncio
async def test_confirmation_skips_retrieval_and_runs_the_pending_tool(mock_db, settings, agent_context):
    agent_context.pending_action = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking",
                                          parameters={"booking_id": "12345"}, requires_action=True)
    with pipeline(action=ActionResult(tool="cancel_booking", success=True, output={"status": "Cancelled"})) as p:
        await handle_message("yes", agent_context, mock_db, settings)
    p.retrieve.assert_not_called()
    p.classify.assert_not_called()
    p.action.assert_awaited_once()


@pytest.mark.asyncio
async def test_irrelevant_kb_question_abstains_before_drafting(mock_db, settings, agent_context):
    with pipeline(retrieval=RetrievalResult(should_abstain=True)) as p:
        response = await handle_message("do you sell shoes for runners", agent_context, mock_db, settings)
    p.draft.assert_not_called()
    p.verify.assert_not_called()
    assert response.was_abstained and response.content == ABSTENTION_MESSAGE


@pytest.mark.asyncio
async def test_booking_question_with_no_kb_match_still_runs_the_tool(mock_db, settings, agent_context):
    intent = Intent(intent="BOOKING_LIST", tool_name="list_bookings", requires_action=True, confidence=0.9)
    with pipeline(retrieval=RetrievalResult(should_abstain=True), intent=intent) as p:
        response = await handle_message("show my bookings", agent_context, mock_db, settings)
    p.action.assert_awaited_once()
    assert not response.was_abstained


@pytest.mark.asyncio
async def test_retrieval_failure_is_an_error_reply_not_an_abstention(mock_db, settings, agent_context):
    with pipeline(retrieval=RetrievalResult(should_abstain=True, failed=True)) as p:
        response = await handle_message("what is the fasting rule", agent_context, mock_db, settings)
    p.draft.assert_not_called()
    assert "something went wrong" in response.content


@pytest.mark.asyncio
async def test_tool_only_turn_skips_verifier_and_sends_no_chunks(mock_db, settings, agent_context):
    intent = Intent(intent="BOOKING_LIST", tool_name="list_bookings", requires_action=True, confidence=0.9)
    with pipeline(intent=intent, draft="You have 1 booking.") as p:
        response = await handle_message("show my bookings", agent_context, mock_db, settings)
    p.verify.assert_not_called()
    assert p.draft.await_args.args[1] == []
    assert response.verifier_verdict == "TOOL_ONLY"
    assert response.content == "You have 1 booking."


@pytest.mark.asyncio
async def test_kb_turn_still_runs_the_verifier(mock_db, settings, agent_context):
    with pipeline() as p:
        await handle_message("what is the fasting rule", agent_context, mock_db, settings)
    p.verify.assert_awaited_once()


@pytest.mark.asyncio
async def test_intent_and_search_overlap_in_parallel_mode(mock_db, settings, agent_context):
    import asyncio

    search_started = asyncio.Event()

    async def retrieve(*_a, **_k):
        search_started.set()
        return RetrievalResult(chunks=[CHUNK], max_similarity=0.9)

    async def classify(*_a, **_k):
        # Only finishes if the search is already running alongside it.
        await asyncio.wait_for(search_started.wait(), timeout=1)
        return Intent(intent="FAQ", confidence=0.9)

    with pipeline() as p:
        p.retrieve.side_effect = retrieve
        p.classify.side_effect = classify
        await handle_message("what is the fasting rule", agent_context, mock_db, settings)
    assert p.classify.await_args.args[1] == ""  # no retrieval titles when parallel


@pytest.mark.asyncio
async def test_sequential_mode_gives_intent_the_titles(mock_db, settings, agent_context):
    settings.parallel_intent_retrieval = False
    with pipeline() as p:
        await handle_message("what is the fasting rule", agent_context, mock_db, settings)
    assert "Fasting (faq" in p.classify.await_args.args[1]


@pytest.mark.asyncio
async def test_catalog_tool_turn_keeps_chunks_and_runs_the_verifier(mock_db, settings, agent_context):
    intent = Intent(intent="CATALOG_SEARCH", tool_name="search_catalog", requires_action=True, confidence=0.9)
    action = ActionResult(tool="search_catalog", success=True, output={"items": [{"name": "CBC", "price": 299}]})
    with pipeline(intent=intent, action=action) as p:
        response = await handle_message("price of cbc", agent_context, mock_db, settings)
    p.verify.assert_awaited_once()
    assert p.draft.await_args.args[1] == [CHUNK]
    assert response.verifier_verdict == "GROUNDED"


@pytest.mark.asyncio
async def test_failed_booking_action_gets_a_fixed_reply_not_a_draft(mock_db, settings, agent_context):
    from app.agents.orchestrator import ACTION_FAILED_RESPONSE

    intent = Intent(intent="BOOKING_STATUS", tool_name="get_booking_status",
                    parameters={"booking_id": "999"}, requires_action=True, confidence=0.9)
    failed = ActionResult(tool="get_booking_status", success=False, error="Booking not found")
    with pipeline(intent=intent, action=failed) as p:
        response = await handle_message("status of 999", agent_context, mock_db, settings)
    p.draft.assert_not_called()
    assert response.content == ACTION_FAILED_RESPONSE


@pytest.mark.asyncio
async def test_done_write_is_confirmed_even_if_the_draft_fails(mock_db, settings, agent_context):
    agent_context.pending_action = Intent(intent="BOOKING_CANCEL", tool_name="cancel_booking",
                                          parameters={"booking_id": "12345"}, requires_action=True)
    done = ActionResult(tool="cancel_booking", success=True, output={"status": "Cancelled"})
    with pipeline(action=done, draft=ABSTENTION_MESSAGE):
        response = await handle_message("yes", agent_context, mock_db, settings)
    assert response.content == "Done. Your booking has been cancelled."
    assert not response.was_abstained


@pytest.mark.asyncio
async def test_quota_error_during_search_gives_the_busy_reply(mock_db, settings, agent_context):
    from app.agents.llm import AIBusyError
    from app.agents.orchestrator import BUSY_RESPONSE

    with pipeline() as p:
        p.retrieve.side_effect = AIBusyError()
        response = await handle_message("what is the fasting rule", agent_context, mock_db, settings)
    assert response.content == BUSY_RESPONSE


@pytest.mark.asyncio
async def test_retrieve_turns_embedding_429_into_busy(mock_db, settings):
    from google.genai import errors

    from app.agents.llm import AIBusyError
    from app.agents.retrieval import retrieve

    quota = errors.ClientError(429, {"error": {"message": "quota", "status": "RESOURCE_EXHAUSTED"}})
    with (
        patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, side_effect=quota),
        pytest.raises(AIBusyError),
    ):
        await retrieve("fasting", mock_db, settings)


def test_bookings_are_compacted_to_five_rows():
    bookings = [
        {"id": f"b{i}", "status": "Order Booked", "items": ["CBC", "Lipid"], "slotDate": "2026-10-20",
         "slotTime": "09:00", "address": {"line1": "secret street"}, "totalAmount": 999}
        for i in range(8)
    ]
    out = compact_tool_output("list_bookings", bookings)
    assert out.count("\n") == 4  # five lines
    assert "b0" in out and "b5" not in out
    assert "CBC, Lipid" in out and "secret street" not in out


def test_fake_express_booking_shape_is_compacted():
    out = compact_tool_output("list_bookings", {"bookings": [
        {"id": "12345", "status": "Order Booked", "tests": ["CBC"], "slot": "Tomorrow 09:00-10:00"}]})
    assert out == "id=12345 | tests=CBC | when=Tomorrow 09:00-10:00 | status=Order Booked"


def test_other_tool_output_stays_json_but_bounded():
    out = compact_tool_output("get_booking_status", {"id": "1", "status": "Done", "notes": "x" * 2000})
    assert out.startswith("{") and len(out) <= 800


def _client(response):
    generate = AsyncMock(return_value=response)
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate))), generate


@pytest.mark.asyncio
async def test_call_gemini_sends_thinking_level_and_cap(settings):
    from app.agents.llm import call_gemini

    resp = SimpleNamespace(text="ok", usage_metadata=None, candidates=[])
    client, generate = _client(resp)
    with patch("app.agents.llm.get_genai_client", return_value=client):
        await call_gemini("p", settings, stage="intent")
    config = generate.await_args.kwargs["config"]
    assert config.thinking_config.thinking_level == types.ThinkingLevel.LOW
    assert config.max_output_tokens == settings.intent_max_output_tokens


@pytest.mark.asyncio
async def test_cap_hit_raises_so_callers_use_their_fallback(settings):
    from app.agents.llm import TruncatedResponseError, call_gemini

    resp = SimpleNamespace(text="partial", usage_metadata=None,
                           candidates=[SimpleNamespace(finish_reason=types.FinishReason.MAX_TOKENS)])
    client, _ = _client(resp)
    with patch("app.agents.llm.get_genai_client", return_value=client), pytest.raises(TruncatedResponseError):
        await call_gemini("p", settings, stage="draft")


def test_prompts_put_static_text_before_customer_data():
    from app.prompts.intent import INTENT_CLASSIFICATION_PROMPT
    from app.prompts.system import DRAFT_GENERATION_PROMPT
    from app.prompts.verifier import VERIFIER_PROMPT

    for template, first_var in [
        (INTENT_CLASSIFICATION_PROMPT, "{conversation_history}"),
        (DRAFT_GENERATION_PROMPT, "{context}"),
        (VERIFIER_PROMPT, "{sources}"),
    ]:
        assert template.index("Instructions") < template.index(first_var)


@pytest.mark.asyncio
async def test_tool_turn_cancels_the_unused_search(mock_db, settings, agent_context):
    import asyncio

    finished = []

    async def slow_retrieve(*_a, **_k):
        await asyncio.sleep(0.5)
        finished.append(True)
        return RetrievalResult()

    intent = Intent(intent="BOOKING_LIST", tool_name="list_bookings", requires_action=True, confidence=0.9)
    async def action_after_cancel(*_a, **_k):
        await asyncio.sleep(0)  # let the cancellation land
        assert p.retrieve_task_cancelled(), "search should be cancelled before the tool runs"
        return ActionResult(tool="list_bookings", success=True, output={"bookings": []})

    with pipeline(intent=intent) as p:
        tasks = []
        real_create_task = asyncio.create_task

        def track(coro):
            task = real_create_task(coro)
            tasks.append(task)
            return task

        p.retrieve_task_cancelled = lambda: bool(tasks) and tasks[0].cancelled()
        p.retrieve.side_effect = slow_retrieve
        p.action.side_effect = action_after_cancel
        with patch("app.agents.orchestrator.asyncio.create_task", side_effect=track):
            response = await handle_message("show my bookings", agent_context, mock_db, settings)
        await asyncio.sleep(0.6)
    assert finished == []
    assert response.verifier_verdict == "TOOL_ONLY"  # an assertion inside the tool would turn into an error reply


@pytest.mark.asyncio
async def test_unsupported_thinking_level_retries_without_it(settings):
    from google.genai import errors

    from app.agents.llm import call_gemini

    rejected = errors.ClientError(400, {"error": {"code": 400, "status": "INVALID_ARGUMENT",
                                              "message": "Thinking level MINIMAL is not supported for this model."}})
    ok = SimpleNamespace(text="ok", usage_metadata=None, candidates=[])
    generate = AsyncMock(side_effect=[rejected, ok])
    client = SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))
    with patch("app.agents.llm.get_genai_client", return_value=client):
        assert await call_gemini("p", settings, stage="intent") == "ok"
    assert generate.await_args_list[1].kwargs["config"].thinking_config is None


def test_default_thinking_levels_are_supported_by_gemini_flash(settings):
    # gemini-3.7-flash rejects "minimal" (checked on the live API 15-10-2026).
    for stage in ("intent", "draft", "verifier"):
        assert getattr(settings, f"{stage}_thinking_level") != "minimal"


@pytest.mark.asyncio
async def test_logged_out_visitor_can_ask_catalog_prices(mock_db, settings, unauthenticated_context):
    intent = Intent(intent="CATALOG_SEARCH", tool_name="search_catalog", requires_action=True, confidence=0.9)
    action = ActionResult(tool="search_catalog", success=True, output={"items": [{"name": "Lipid", "price": 499}]})
    with pipeline(intent=intent, action=action) as p:
        response = await handle_message("price of lipid profile", unauthenticated_context, mock_db, settings)
    p.action.assert_awaited_once()
    assert "log in" not in response.content.lower()


@pytest.mark.asyncio
async def test_logged_out_visitor_is_asked_to_log_in_for_bookings(mock_db, settings, unauthenticated_context):
    intent = Intent(intent="BOOKING_LIST", tool_name="list_bookings", requires_action=True, confidence=0.9)
    with pipeline(intent=intent) as p:
        response = await handle_message("show my bookings", unauthenticated_context, mock_db, settings)
    p.action.assert_not_called()
    assert "log in" in response.content.lower()
