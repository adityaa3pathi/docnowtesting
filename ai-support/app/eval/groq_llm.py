"""Eval-only stand-in for call_gemini that runs the pipeline on an open model hosted by Groq."""
from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any

from groq import AsyncGroq, BadRequestError, RateLimitError

from app.agents import llm, usage

# gpt-oss takes a reasoning effort, not a Gemini thinking level; "" means the model default.
_EFFORT = {"minimal": "low", "low": "low", "medium": "medium", "high": "high"}


def make_groq_call(model: str):
    client = AsyncGroq(api_key=os.environ["SUPPORT_GROQ_API_KEY"])

    async def call(
        prompt: str,
        settings: Any,
        system_prompt: str | None = None,
        temperature: float = 0.7,
        response_mime_type: str | None = None,
        response_json_schema: dict[str, Any] | None = None,
        stage: str = "llm",
    ) -> str:
        system = system_prompt or ""
        kwargs: dict[str, Any] = {"model": model, "temperature": temperature}
        if response_json_schema or response_mime_type == "application/json":
            kwargs["response_format"] = {"type": "json_object"}
            if response_json_schema:
                system += f"\nReturn only JSON matching this schema: {json.dumps(response_json_schema)}"
        # Uncapped code gets a generous limit; Groq's default is too short for reasoning plus JSON.
        kwargs["max_tokens"] = getattr(settings, f"{stage}_max_output_tokens", None) or 3000
        if effort := _EFFORT.get(getattr(settings, f"{stage}_thinking_level", "")):
            kwargs["reasoning_effort"] = effort
        messages = [{"role": "system", "content": system}] if system else []
        messages.append({"role": "user", "content": prompt})

        start = time.monotonic()
        for attempt in range(15):
            try:
                resp = await client.chat.completions.create(messages=messages, **kwargs)
                break
            except RateLimitError as exc:
                if "per day" in str(exc).lower() or attempt == 14:
                    raise llm.AIBusyError from exc
                # Free tier allows 8k tokens a minute; wait out the window.
                await asyncio.sleep(min(65, 10 * (attempt + 1)))
            except BadRequestError as exc:
                # JSON cut off by max_tokens is the same event as a Gemini cap hit.
                if "max completion tokens" not in str(exc):
                    raise
                usage.record(usage.CallUsage(stage=stage, model=model, cap_hit=True))
                truncated = getattr(llm, "TruncatedResponseError", None)
                raise (truncated(stage) if truncated else ValueError("reply cut off")) from exc

        u = resp.usage
        details = getattr(u, "completion_tokens_details", None)
        reasoning = int(getattr(details, "reasoning_tokens", 0) or 0)
        choice = resp.choices[0]
        call_usage = usage.CallUsage(
            stage=stage,
            model=model,
            prompt_tokens=u.prompt_tokens,
            output_tokens=u.completion_tokens - reasoning,
            thought_tokens=reasoning,
            latency_ms=int((time.monotonic() - start) * 1000),
            cap_hit=choice.finish_reason == "length",
        )
        usage.record(call_usage)
        truncated = getattr(llm, "TruncatedResponseError", None)
        if call_usage.cap_hit and truncated:
            raise truncated(stage)
        return choice.message.content or ""

    return call
