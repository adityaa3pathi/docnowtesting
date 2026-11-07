"""The SDK has no default timeout, so a stalled Gemini call used to hang the chat forever."""
from __future__ import annotations

import pytest

from app import genai_client
from app.config import Settings


@pytest.fixture(autouse=True)
def reset_client():
    genai_client._client = None
    yield
    genai_client._client = None


def test_client_is_built_with_a_millisecond_timeout():
    settings = Settings(gemini_api_key="test-key", genai_timeout_seconds=30.0, _env_file=None)

    client = genai_client.get_genai_client(settings)

    # HttpOptions.timeout is milliseconds in google-genai.
    assert client._api_client._http_options.timeout == 30_000


def test_timeout_is_configurable():
    settings = Settings(gemini_api_key="test-key", genai_timeout_seconds=5.5, _env_file=None)
    client = genai_client.get_genai_client(settings)
    assert client._api_client._http_options.timeout == 5_500


def test_default_timeout_is_set():
    assert Settings(_env_file=None).genai_timeout_seconds == 30.0
