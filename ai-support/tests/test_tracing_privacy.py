"""Traces must never carry tokens, keys or customer data (U2)."""
from __future__ import annotations

import ast
from pathlib import Path
from unittest.mock import MagicMock, patch

from app import observability

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _is_observe(node: ast.AST) -> bool:
    return getattr(node, "id", None) == "observe" or getattr(node, "attr", None) == "observe"


def _observe_calls():
    for path in APP_DIR.rglob("*.py"):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for deco in node.decorator_list:
                if isinstance(deco, ast.Call) and _is_observe(deco.func):
                    yield path.name, {kw.arg: kw.value for kw in deco.keywords}
                elif _is_observe(deco):
                    yield path.name, {}  # bare @observe captures everything


def test_every_observe_turns_off_input_and_output_capture():
    calls = list(_observe_calls())
    assert calls, "expected @observe sites"
    for name, kwargs in calls:
        for flag in ("capture_input", "capture_output"):
            assert flag in kwargs, f"{name}: @observe without {flag}=False"
            value = kwargs[flag]
            assert isinstance(value, ast.Constant) and value.value is False, f"{name}: {flag} must be False"


def test_langfuse_stays_off_unless_enabled(settings):
    settings.langfuse_public_key = "pk"
    settings.langfuse_secret_key = "sk"
    settings.langfuse_enabled = False
    with patch("app.observability.Langfuse") as client:
        observability.init_langfuse(settings)
    client.assert_not_called()


def test_langfuse_starts_when_enabled_with_keys(settings):
    settings.langfuse_public_key = "pk"
    settings.langfuse_secret_key = "sk"
    settings.langfuse_enabled = True
    with patch("app.observability.Langfuse") as client, patch.object(observability, "_langfuse_client", None):
        observability.init_langfuse(settings)
    client.assert_called_once()


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
