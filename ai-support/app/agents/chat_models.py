"""LangChain chat models behind call_gemini: the configured Gemini model, then fallbacks on outage errors.

call_gemini keeps its signature (the eval and tests patch it); only the transport changed. Each call
goes primary -> fallback 1 -> ... via Runnable.with_fallbacks, and only on errors another model could
get past: rate limits, 5xx, timeouts, connection failures, a retired model (404) and exhausted credits
(402). A bad request (400) is not retried elsewhere, since it would fail on any model.

Calls go through the process-wide google-genai client (app/genai_client.py). Its retry and timeout
(2 attempts on 429/503 only, then fail over) are also passed per request, because LangChain otherwise
applies its own max_retries=6.
"""
from __future__ import annotations

import asyncio
import warnings
from functools import lru_cache
from typing import Any

from google.genai import errors, types
from langchain_core.exceptions import (
    ModelAPIError,
    ModelConnectionError,
    ModelNotFoundError,
    ModelRateLimitError,
    ModelTimeoutError,
)
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import Runnable, RunnableLambda
from langchain_google_genai import ChatGoogleGenerativeAI

from app.genai_client import get_genai_client

# HTTP statuses worth trying another model for.
FAILOVER_STATUSES = frozenset({402, 404, 408, 429, 500, 502, 503, 504})
# Statuses that mean "the AI is unavailable right now" once every model has failed.
BUSY_STATUSES = frozenset({402, 429, 503})

# gemini-3.5-flash-lite ignores sampling parameters; LangChain drops them and warns on every call.
warnings.filterwarnings("ignore", message=r"Model '.*' uses fixed sampling defaults")


class FailoverError(Exception):
    """A model call failed in a way another model might not; carries the HTTP status if known."""

    def __init__(self, model: str, status: int | None, cause: BaseException) -> None:
        super().__init__(f"{model} failed ({status or type(cause).__name__}): {cause}")
        self.model = model
        self.status = status


def status_of(exc: BaseException) -> int | None:
    """HTTP status from a LangChain error, the google-genai error under it, or None."""
    seen: BaseException | None = exc
    while seen is not None:
        for attr in ("code", "status_code"):
            value = getattr(seen, attr, None)
            if isinstance(value, int):
                return value
        seen = seen.__cause__ or seen.__context__
    return None


def _should_fail_over(exc: BaseException) -> bool:
    if isinstance(exc, (ModelRateLimitError, ModelAPIError, ModelNotFoundError, ModelTimeoutError,
                        ModelConnectionError, TimeoutError, asyncio.TimeoutError, errors.ServerError)):
        return True
    status = status_of(exc)
    if status in FAILOVER_STATUSES:
        return True
    # DNS and socket failures come up from aiohttp/httpx unwrapped.
    return type(exc).__module__.split(".")[0] in ("aiohttp", "httpx", "httpcore") or isinstance(exc, OSError)


def _http_options(settings: Any) -> types.HttpOptions:
    return types.HttpOptions(
        retry_options=types.HttpRetryOptions(attempts=2, initial_delay=2, max_delay=4, http_status_codes=[429, 503]),
        timeout=int(getattr(settings, "genai_timeout_seconds", 30.0) * 1000),
    )


@lru_cache(maxsize=64)
def _chat_model(api_key: str, model: str, thinking_level: str, max_output_tokens: int | None) -> ChatGoogleGenerativeAI:
    kwargs: dict[str, Any] = {"model": model, "google_api_key": api_key}
    if thinking_level:
        kwargs["thinking_level"] = thinking_level.lower()
    if max_output_tokens:
        kwargs["max_output_tokens"] = max_output_tokens
    return ChatGoogleGenerativeAI(**kwargs)


def _guarded(model: ChatGoogleGenerativeAI, settings: Any) -> Runnable:
    """The model, with outage errors turned into FailoverError so with_fallbacks moves on."""

    async def call(messages: list, **kwargs: Any) -> AIMessage:
        # The process-wide google-genai client (also used for embeddings), not one per LangChain model.
        model.client = get_genai_client(settings)
        try:
            return await model.ainvoke(messages, http_options=_http_options(settings), **kwargs)
        except Exception as exc:
            if _should_fail_over(exc):
                raise FailoverError(model.model, status_of(exc), exc) from exc
            raise

    async def run(payload: dict) -> AIMessage:
        return await call(payload["messages"], **payload["kwargs"])

    return RunnableLambda(run, name=model.model)


def fallback_models(settings: Any) -> list[str]:
    raw = getattr(settings, "llm_fallback_models", "") or ""
    return [m.strip() for m in raw.split(",") if m.strip() and m.strip() != settings.llm_model]


def build_chain(settings: Any, stage: str, thinking_level: str, max_output_tokens: int | None) -> Runnable:
    """Primary model with fallbacks. Fallbacks run without a thinking level: not every model accepts one."""
    key = settings.gemini_api_key
    primary = _guarded(_chat_model(key, settings.llm_model, thinking_level, max_output_tokens), settings)
    backups = [_guarded(_chat_model(key, m, "", max_output_tokens), settings) for m in fallback_models(settings)]
    return primary.with_fallbacks(backups, exceptions_to_handle=(FailoverError,)) if backups else primary


def messages_for(prompt: str, system_prompt: str | None) -> list:
    return ([SystemMessage(content=system_prompt)] if system_prompt else []) + [HumanMessage(content=prompt)]
