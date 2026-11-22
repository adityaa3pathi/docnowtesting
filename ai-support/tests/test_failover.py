"""Phase 4: model failover (with_fallbacks) behind call_gemini, with forced errors."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import patch

import pytest
from google.genai import errors
from langchain_core.messages import AIMessage

from app.agents import chat_models, usage
from app.agents.llm import AIBusyError, call_gemini


def _settings(**kw):
    base = dict(llm_model="primary-model", llm_fallback_models="backup-model", gemini_api_key="k",
                genai_timeout_seconds=30.0, intent_thinking_level="low", intent_max_output_tokens=512)
    return SimpleNamespace(**{**base, **kw})


def _reply(text="ok", model="backup-model", finish="STOP", prompt=100, out=10, thoughts=0):
    usage_md = {"input_tokens": prompt, "output_tokens": out + thoughts, "total_tokens": prompt + out + thoughts,
                "input_token_details": {"cache_read": 0}}
    if thoughts:
        usage_md["output_token_details"] = {"reasoning": thoughts}
    return AIMessage(content=text, usage_metadata=usage_md,
                     response_metadata={"model_name": model, "finish_reason": finish})


def server_error(code=503):
    return errors.ServerError(code, {"error": {"code": code, "message": "overloaded", "status": "UNAVAILABLE"}})


def client_error(code):
    return errors.ClientError(code, {"error": {"code": code, "message": "nope", "status": "X"}})


class FakeModels:
    """Stands in for ChatGoogleGenerativeAI.ainvoke per model name; records which models were called."""

    def __init__(self, behaviour: dict):
        self.behaviour, self.calls = behaviour, []

    async def ainvoke(self, model_self, messages, **kwargs):
        self.calls.append(model_self.model)
        result = self.behaviour[model_self.model]
        if isinstance(result, BaseException):
            raise result
        return result


@pytest.fixture
def fake():
    chat_models._chat_model.cache_clear()

    def install(behaviour):
        models = FakeModels(behaviour)

        async def ainvoke(self, messages, **kwargs):
            return await models.ainvoke(self, messages, **kwargs)

        p = patch("langchain_google_genai.ChatGoogleGenerativeAI.ainvoke", ainvoke)
        p.start()
        return models, p

    patches = []
    yield lambda b: (lambda m, p: (patches.append(p), m)[1])(*install(b))
    for p in patches:
        p.stop()
    chat_models._chat_model.cache_clear()


@pytest.mark.parametrize("error", [server_error(503), server_error(500), client_error(429), client_error(402),
                                   client_error(404), TimeoutError()])
async def test_outage_error_on_primary_fails_over_and_tracks_the_model_that_answered(fake, error):
    models = fake({"primary-model": error, "backup-model": _reply("from backup")})
    with usage.track_turn() as turn:
        text = await call_gemini("hi", _settings(), stage="intent")
    assert text == "from backup"
    assert models.calls == ["primary-model", "backup-model"]
    assert [c.model for c in turn.calls] == ["backup-model"]  # tokens counted once, on the model that answered
    assert turn.total_tokens() == 110


async def test_bad_request_does_not_fail_over(fake):
    models = fake({"primary-model": client_error(400), "backup-model": _reply()})
    with pytest.raises(Exception):
        await call_gemini("hi", _settings(), stage="intent")
    assert models.calls == ["primary-model"]


async def test_every_model_down_is_busy(fake):
    models = fake({"primary-model": server_error(503), "backup-model": client_error(429)})
    with pytest.raises(AIBusyError):
        await call_gemini("hi", _settings(), stage="intent")
    assert models.calls == ["primary-model", "backup-model"]


async def test_exhausted_credits_with_no_fallback_is_busy_not_an_error(fake):
    fake({"primary-model": client_error(402)})
    with pytest.raises(AIBusyError):
        await call_gemini("hi", _settings(llm_fallback_models=""), stage="intent")


async def test_healthy_primary_never_touches_the_fallback(fake):
    models = fake({"primary-model": _reply("primary", model="primary-model", thoughts=7), "backup-model": _reply()})
    with usage.track_turn() as turn:
        assert await call_gemini("hi", _settings(), stage="intent") == "primary"
    assert models.calls == ["primary-model"]
    call = turn.calls[0]
    assert (call.prompt_tokens, call.output_tokens, call.thought_tokens) == (100, 10, 7)


async def test_output_cap_is_still_a_truncation_not_a_failover(fake):
    from app.agents.llm import TruncatedResponseError

    models = fake({"primary-model": _reply(finish="MAX_TOKENS", model="primary-model"), "backup-model": _reply()})
    with usage.track_turn() as turn, pytest.raises(TruncatedResponseError):
        await call_gemini("hi", _settings(), stage="intent")
    assert models.calls == ["primary-model"]
    assert turn.calls[0].cap_hit


def test_fallback_list_skips_blanks_and_the_primary():
    s = _settings(llm_fallback_models=" backup-model, ,primary-model,other ")
    assert chat_models.fallback_models(s) == ["backup-model", "other"]
