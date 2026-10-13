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
        # One short retry rides out a brief 429/503; long waits hung the chat past
        # the backend's timeout when the daily quota ran out (13-10-2026).
        retry = types.HttpRetryOptions(attempts=2, initial_delay=2, max_delay=4, http_status_codes=[429, 503])
        _client = genai.Client(
            api_key=settings.gemini_api_key, http_options=types.HttpOptions(retry_options=retry)
        )
    return _client
