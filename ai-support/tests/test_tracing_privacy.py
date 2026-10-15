"""Traces must never carry tokens, keys or customer data (U2)."""
from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import observability

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _observe_calls():
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "observe":
                yield path.name, {kw.arg: kw.value for kw in node.keywords}


def test_every_observe_turns_off_input_and_output_capture():
    calls = list(_observe_calls())
    assert calls, "expected @observe sites"
    for name, kwargs in calls:
        for flag in ("capture_input", "capture_output"):
            assert flag in kwargs, f"{name}: @observe without {flag}=False"
            assert getattr(kwargs[flag], "value", None) is False, f"{name}: {flag} must be False"


def test_langfuse_stays_off_unless_enabled(settings):
    settings.langfuse_public_key = "pk"
    settings.langfuse_secret_key = "sk"
    settings.langfuse_enabled = False
    with patch("app.observability.Langfuse") as client:
        observability.init_langfuse(settings)
    client.assert_not_called()


def test_annotate_drops_unsafe_fields():
    fake = MagicMock()
    with patch.object(observability, "_langfuse_client", fake), patch("app.observability.get_client", return_value=fake):
        observability.annotate(intent="BOOKING", access_token="secret", tool="list_bookings", output={"phone": "9"})
    sent = fake.update_current_span.call_args.kwargs["metadata"]
    assert sent == {"intent": "BOOKING", "tool": "list_bookings"}


def test_annotate_is_silent_when_tracing_off():
    with patch.object(observability, "_langfuse_client", None), patch("app.observability.get_client") as gc:
        observability.annotate(intent="X")
    gc.assert_not_called()
