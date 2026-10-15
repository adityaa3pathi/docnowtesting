from __future__ import annotations

import logging
import time
from typing import Any, Optional

from google.genai import errors, types

from app.agents import usage
from app.genai_client import get_genai_client

logger = logging.getLogger(__name__)


class AIBusyError(Exception):
    """Gemini quota is used up; callers must not turn this into a normal answer."""


class TruncatedResponseError(Exception):
    """The output cap cut the reply short; callers fall back instead of using partial text."""


async def call_gemini(
    prompt: str,
    settings: Any,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
    response_json_schema: Optional[dict[str, Any]] = None,
    stage: str = "llm",
) -> str:
    """Calls the Gemini API."""
    config_kwargs: dict[str, Any] = {"temperature": temperature}
    thinking_level = getattr(settings, f"{stage}_thinking_level", "")
    if thinking_level:
        config_kwargs["thinking_config"] = types.ThinkingConfig(thinking_level=thinking_level.upper())
    max_output = getattr(settings, f"{stage}_max_output_tokens", None)
    if max_output:
        config_kwargs["max_output_tokens"] = max_output
    if system_prompt:
        config_kwargs["system_instruction"] = system_prompt
    if response_mime_type:
        config_kwargs["response_mime_type"] = response_mime_type
    if response_json_schema:
        # Gemini then guarantees the JSON shape instead of us hoping for it.
        config_kwargs["response_mime_type"] = "application/json"
        config_kwargs["response_json_schema"] = response_json_schema

    try:
        start = time.monotonic()
        response = await get_genai_client(settings).aio.models.generate_content(
            model=settings.llm_model,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        call = usage.from_response(response, stage, settings.llm_model, int((time.monotonic() - start) * 1000))
        usage.record(call)
        logger.info(
            "gemini stage=%s prompt=%d output=%d thoughts=%d cached=%d latency_ms=%d cap_hit=%s",
            stage, call.prompt_tokens, call.output_tokens, call.thought_tokens,
            call.cached_tokens, call.latency_ms, call.cap_hit,
        )
        if call.cap_hit:
            raise TruncatedResponseError(stage)
        return response.text
    except errors.ClientError as exc:
        if exc.code == 429:
            logger.warning("Gemini quota exhausted: %s", exc.message)
            raise AIBusyError from exc
        logger.exception("Error calling Gemini API")
        raise
    except TruncatedResponseError:
        logger.warning("Gemini %s reply hit its output cap", stage)
        raise
    except Exception:
        logger.exception("Error calling Gemini API")
        raise
