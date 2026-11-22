from __future__ import annotations

import logging
import time
from typing import Any, Optional

from app.agents import usage
from app.agents.chat_models import BUSY_STATUSES, FailoverError, build_chain, messages_for, status_of

logger = logging.getLogger(__name__)


class AIBusyError(Exception):
    """Gemini quota is used up; callers must not turn this into a normal answer."""


class TruncatedResponseError(Exception):
    """The output cap cut the reply short; callers fall back instead of using partial text."""


def _thinking_rejected(exc: BaseException, thinking_level: str) -> bool:
    """A model that rejects the thinking level must not take the whole chat down."""
    return bool(thinking_level) and status_of(exc) == 400 and "thinking" in str(exc).lower()


async def call_gemini(
    prompt: str,
    settings: Any,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
    response_json_schema: Optional[dict[str, Any]] = None,
    stage: str = "llm",
) -> str:
    """One model call: the configured Gemini model, then settings.llm_fallback_models on outage errors.

    Raises AIBusyError when every model is unavailable (429/503, or 402 exhausted credits),
    TruncatedResponseError when the output cap cut the reply short.
    """
    thinking_level = getattr(settings, f"{stage}_thinking_level", "") or ""
    max_output = getattr(settings, f"{stage}_max_output_tokens", None)
    kwargs: dict[str, Any] = {"temperature": temperature}
    if response_json_schema:
        # Gemini then guarantees the JSON shape instead of us hoping for it.
        kwargs["response_mime_type"] = "application/json"
        kwargs["response_json_schema"] = response_json_schema
    elif response_mime_type:
        kwargs["response_mime_type"] = response_mime_type
    payload = {"messages": messages_for(prompt, system_prompt), "kwargs": kwargs}

    start = time.monotonic()
    try:
        try:
            message = await build_chain(settings, stage, thinking_level, max_output).ainvoke(payload)
        except Exception as exc:
            if not _thinking_rejected(exc, thinking_level):
                raise
            logger.warning("Model %s rejected %s thinking config; retrying without it", settings.llm_model, stage)
            message = await build_chain(settings, stage, "", max_output).ainvoke(payload)
    except FailoverError as exc:
        if exc.status in BUSY_STATUSES:
            logger.warning("All models unavailable for %s (%s): %s", stage, exc.status, exc)
            raise AIBusyError from exc
        logger.exception("Error calling Gemini API")
        raise
    except Exception:
        logger.exception("Error calling Gemini API")
        raise

    call = usage.from_response(message, stage, settings.llm_model, int((time.monotonic() - start) * 1000))
    usage.record(call)
    if call.model != settings.llm_model:
        logger.warning("gemini stage=%s answered by fallback model %s", stage, call.model)
    logger.info(
        "gemini stage=%s model=%s prompt=%d output=%d thoughts=%d cached=%d latency_ms=%d cap_hit=%s",
        stage, call.model, call.prompt_tokens, call.output_tokens, call.thought_tokens,
        call.cached_tokens, call.latency_ms, call.cap_hit,
    )
    if call.cap_hit:
        logger.warning("Gemini %s reply hit its output cap", stage)
        raise TruncatedResponseError(stage)
    return message.text
