from __future__ import annotations

import logging
from typing import Any, Optional

from google.genai import types

from app.genai_client import get_genai_client

logger = logging.getLogger(__name__)


async def call_gemini(
    prompt: str,
    settings: Any,
    system_prompt: Optional[str] = None,
    temperature: float = 0.7,
    response_mime_type: Optional[str] = None,
) -> str:
    """Calls the Gemini API."""
    config_kwargs: dict[str, Any] = {"temperature": temperature}
    if system_prompt:
        config_kwargs["system_instruction"] = system_prompt
    if response_mime_type:
        config_kwargs["response_mime_type"] = response_mime_type

    try:
        response = await get_genai_client(settings).aio.models.generate_content(
            model=settings.llm_model,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        return response.text
    except Exception:
        logger.exception("Error calling Gemini API")
        raise
