"""Token usage tracking per chat turn (U1)."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from google.genai import types

from app.agents import usage
from app.agents.llm import call_gemini


def _response(prompt=100, output=20, thoughts=5, cached=0, finish=types.FinishReason.STOP, text="ok"):
    meta = SimpleNamespace(
        prompt_token_count=prompt,
        candidates_token_count=output,
        thoughts_token_count=thoughts,
        cached_content_token_count=cached,
    )
    return SimpleNamespace(text=text, usage_metadata=meta, candidates=[SimpleNamespace(finish_reason=finish)])


def _client(*responses):
    generate = AsyncMock(side_effect=list(responses))
    return SimpleNamespace(aio=SimpleNamespace(models=SimpleNamespace(generate_content=generate)))


@pytest.mark.asyncio
async def test_usage_is_summed_across_calls_in_one_turn(settings):
    client = _client(_response(100, 20, 5), _response(300, 80, 10, cached=50), _response(200, 10, 0))
    with patch("app.agents.llm.get_genai_client", return_value=client), usage.track_turn() as turn:
        for stage in ("intent", "draft", "verifier"):
            await call_gemini("p", settings, stage=stage)

    summary = turn.summary()
    assert summary["calls"] == 3
    assert summary["prompt_tokens"] == 600
    assert summary["output_tokens"] == 110
    assert summary["thought_tokens"] == 15
    assert summary["cached_tokens"] == 50
    assert turn.total_tokens() == 725
    assert [c["stage"] for c in summary["per_call"]] == ["intent", "draft", "verifier"]


@pytest.mark.asyncio
async def test_missing_usage_metadata_counts_as_zero(settings):
    resp = SimpleNamespace(text="ok", usage_metadata=None, candidates=[])
    with patch("app.agents.llm.get_genai_client", return_value=_client(resp)), usage.track_turn() as turn:
        assert await call_gemini("p", settings, stage="intent") == "ok"
    assert turn.total_tokens() == 0
    assert turn.summary()["calls"] == 1


@pytest.mark.asyncio
async def test_cap_hit_is_recorded(settings):
    resp = _response(finish=types.FinishReason.MAX_TOKENS)
    with patch("app.agents.llm.get_genai_client", return_value=_client(resp)), usage.track_turn() as turn:
        await call_gemini("p", settings, stage="draft")
    assert turn.summary()["cap_hits"] == 1


@pytest.mark.asyncio
async def test_calls_outside_a_turn_do_not_fail(settings):
    with patch("app.agents.llm.get_genai_client", return_value=_client(_response())):
        assert await call_gemini("p", settings, stage="intent") == "ok"


@pytest.mark.asyncio
async def test_handle_message_reports_turn_tokens(mock_db, settings, agent_context):
    from app.agents.orchestrator import handle_message
    from app.models import RetrievalResult

    intent_json = '{"intent": "GREETING", "requires_action": false, "confidence": 0.9}'
    client = _client(_response(120, 30, 6, text=intent_json))
    with (
        patch("app.agents.llm.get_genai_client", return_value=client),
        patch("app.agents.orchestrator.retrieve", new_callable=AsyncMock,
              return_value=RetrievalResult(should_abstain=True)),
    ):
        response = await handle_message("hello", agent_context, mock_db, settings)

    assert response.token_count == 156
    assert response.usage["calls"] == 1
    assert response.usage["per_call"][0]["stage"] == "intent"
