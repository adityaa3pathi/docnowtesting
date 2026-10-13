"""Shared google-genai client, created once per process."""
from __future__ import annotations

from typing import Any

from google import genai
from google.genai import types

_client: genai.Client | None = None


def get_genai_client(settings: Any) -> genai.Client:
    """Return the process-wide client; use `.aio` for calls inside async code."""
    global _client
    if _client is None:
        # Free tier caps calls per minute; wait out a 429 or 503 instead of failing the chat.
        retry = types.HttpRetryOptions(attempts=5, initial_delay=2, max_delay=40, http_status_codes=[429, 503])
        _client = genai.Client(
            api_key=settings.gemini_api_key, http_options=types.HttpOptions(retry_options=retry)
        )
    return _client
