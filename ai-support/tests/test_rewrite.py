"""Phase 4: query rewrite for follow-ups, and merging the rewritten search with the typed one."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, patch

import pytest

from app.agents.llm import AIBusyError
from app.agents.rewrite import merge_results, rewrite_query
from app.models import ActionResult, RetrievalResult, RetrievedChunk

HISTORY = [
    {"role": "user", "content": "Do you have a lipid profile test?"},
    {"role": "assistant", "content": "Yes, we offer the Lipid Profile."},
]


def chunk(cid: str, source: str = "catalog", sim: float = 0.8) -> RetrievedChunk:
    return RetrievedChunk(id=cid, source=source, title=cid, content=cid, similarity=sim)


async def test_first_message_is_not_rewritten_and_makes_no_call(settings, agent_context):
    with patch("app.agents.rewrite.call_gemini", new_callable=AsyncMock) as call:
        assert await rewrite_query("how much is it?", agent_context, settings) == "how much is it?"
    call.assert_not_called()


async def test_follow_up_is_rewritten_with_history(settings, agent_context):
    agent_context.conversation_history = HISTORY
    reply = json.dumps({"query": "Lipid Profile price"})
    with patch("app.agents.rewrite.call_gemini", new_callable=AsyncMock, return_value=reply) as call:
        assert await rewrite_query("how much does it cost?", agent_context, settings) == "Lipid Profile price"
    prompt = call.await_args.kwargs["prompt"]
    assert "Do you have a lipid profile test?" in prompt and "how much does it cost?" in prompt
    assert call.await_args.kwargs["stage"] == "rewrite"


@pytest.mark.parametrize("reply", ["not json", json.dumps({"query": ""}), json.dumps({"query": "x" * 301})])
async def test_bad_rewrite_falls_back_to_the_typed_message(settings, agent_context, reply):
    agent_context.conversation_history = HISTORY
    with patch("app.agents.rewrite.call_gemini", new_callable=AsyncMock, return_value=reply):
        assert await rewrite_query("how much does it cost?", agent_context, settings) == "how much does it cost?"


async def test_rewrite_failure_falls_back_but_busy_is_raised(settings, agent_context):
    agent_context.conversation_history = HISTORY
    with patch("app.agents.rewrite.call_gemini", new_callable=AsyncMock, side_effect=RuntimeError("boom")):
        assert await rewrite_query("how much?", agent_context, settings) == "how much?"
    with patch("app.agents.rewrite.call_gemini", new_callable=AsyncMock, side_effect=AIBusyError()):
        with pytest.raises(AIBusyError):
            await rewrite_query("how much?", agent_context, settings)


def test_merge_fuses_both_item_lists_and_keeps_one_index_chunk():
    rewritten = RetrievalResult(chunks=[chunk("a"), chunk("b"), chunk("idx1", "catalog_index")], max_similarity=0.8)
    typed = RetrievalResult(chunks=[chunk("c"), chunk("a"), chunk("idx2", "catalog_index")], max_similarity=0.7)
    merged = merge_results(rewritten, typed)
    ids = [c.id for c in merged.chunks]
    assert ids[0] == "a"  # in both lists
    assert set(ids[:3]) == {"a", "b", "c"}
    assert ids[-1] == "idx1" and "idx2" not in ids  # the rewritten search's index chunk, appended
    assert not merged.should_abstain and merged.max_similarity == 0.8


def test_merge_caps_items_at_top_k():
    rewritten = RetrievalResult(chunks=[chunk(f"r{i}") for i in range(5)])
    typed = RetrievalResult(chunks=[chunk(f"t{i}") for i in range(5)])
    assert len(merge_results(rewritten, typed).chunks) == 5


def test_merge_abstains_only_if_both_searches_did():
    hit = RetrievalResult(chunks=[chunk("a")], max_similarity=0.8)
    empty = RetrievalResult(should_abstain=True)
    failed = RetrievalResult(failed=True, should_abstain=True)
    assert merge_results(empty, hit) is hit
    assert merge_results(hit, failed) is hit
    assert merge_results(empty, RetrievalResult(should_abstain=True)).should_abstain


# ── Wired into the pipeline (orchestrator.search) ──

from app.agents.orchestrator import handle_message  # noqa: E402
from app.models import Intent, VerificationResult  # noqa: E402

KB = RetrievalResult(chunks=[chunk("catalog:fx-lipid")], max_similarity=0.8)


def _pipeline(intent=None):
    return (
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock, return_value=KB),
        patch("app.agents.orchestrator.rewrite_query", new_callable=AsyncMock, return_value="Lipid Profile price"),
        patch("app.agents.orchestrator.classify_intent", new_callable=AsyncMock,
              return_value=intent or Intent(intent="FAQ", confidence=0.9)),
        patch("app.agents.orchestrator.generate_draft", new_callable=AsyncMock, return_value="It costs 499."),
        patch("app.agents.orchestrator.verify", new_callable=AsyncMock,
              return_value=VerificationResult(verdict="GROUNDED", cleaned_response="It costs 499.")),
    )


async def test_rewrite_off_searches_the_typed_message(mock_db, settings, agent_context):
    settings.query_rewrite = "off"
    agent_context.conversation_history = HISTORY
    p_ret, p_rw, p_cls, p_draft, p_ver = _pipeline()
    with p_ret as ret, p_rw as rw, p_cls, p_draft as draft, p_ver:
        await handle_message("how much does it cost?", agent_context, mock_db, settings)
    rw.assert_not_called()
    assert ret.await_args.args[0] == "how much does it cost?"
    assert draft.await_args.args[0] == "how much does it cost?"


async def test_replace_searches_the_rewrite_but_drafts_from_the_customers_words(mock_db, settings, agent_context):
    settings.query_rewrite = "replace"
    agent_context.conversation_history = HISTORY
    p_ret, p_rw, p_cls, p_draft, p_ver = _pipeline()
    with p_ret as ret, p_rw as rw, p_cls as cls, p_draft as draft, p_ver:
        await handle_message("how much does it cost?", agent_context, mock_db, settings)
    rw.assert_awaited_once()
    assert [c.args[0] for c in ret.await_args_list] == ["Lipid Profile price"]
    assert cls.await_args.args[0] == "how much does it cost?"
    assert draft.await_args.args[0] == "how much does it cost?"


async def test_both_searches_typed_and_rewritten(mock_db, settings, agent_context):
    settings.query_rewrite = "both"
    agent_context.conversation_history = HISTORY
    p_ret, p_rw, p_cls, p_draft, p_ver = _pipeline()
    with p_ret as ret, p_rw, p_cls, p_draft, p_ver:
        await handle_message("how much does it cost?", agent_context, mock_db, settings)
    assert sorted(c.args[0] for c in ret.await_args_list) == ["Lipid Profile price", "how much does it cost?"]


async def test_first_turn_never_calls_the_rewrite(mock_db, settings, agent_context):
    settings.query_rewrite = "replace"
    p_ret, p_rw, p_cls, p_draft, p_ver = _pipeline()
    with p_ret as ret, p_rw as rw, p_cls, p_draft, p_ver:
        await handle_message("How much is the lipid profile?", agent_context, mock_db, settings)
    rw.assert_not_called()
    assert ret.await_args.args[0] == "How much is the lipid profile?"


async def test_booking_turn_cancels_the_rewrite_and_search(mock_db, settings, agent_context):
    settings.query_rewrite = "replace"
    agent_context.conversation_history = HISTORY
    started, cancelled = asyncio.Event(), []

    async def slow_rewrite(*_a, **_k):
        started.set()
        try:
            await asyncio.sleep(5)
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    async def classify(*_a, **_k):
        await started.wait()
        return Intent(intent="BOOKING_LIST", tool_name="list_bookings", requires_action=True, confidence=0.9)

    p_ret, _, _, p_draft, p_ver = _pipeline()
    with (
        p_ret as ret, p_draft, p_ver,
        patch("app.agents.orchestrator.rewrite_query", side_effect=slow_rewrite),
        patch("app.agents.orchestrator.classify_intent", side_effect=classify),
        patch("app.agents.action.execute_action", new_callable=AsyncMock,
              return_value=ActionResult(tool="list_bookings", success=True, output={"bookings": []})),
    ):
        await handle_message("show my bookings", agent_context, mock_db, settings)
    assert cancelled == [True]
    ret.assert_not_called()


async def test_busy_rewrite_gives_the_busy_reply(mock_db, settings, agent_context):
    from app.agents.orchestrator import BUSY_RESPONSE

    settings.query_rewrite = "replace"
    agent_context.conversation_history = HISTORY
    p_ret, _, p_cls, p_draft, p_ver = _pipeline()
    with p_ret, p_cls, p_draft, p_ver, patch("app.agents.orchestrator.rewrite_query", side_effect=AIBusyError()):
        response = await handle_message("how much does it cost?", agent_context, mock_db, settings)
    assert response.content == BUSY_RESPONSE
