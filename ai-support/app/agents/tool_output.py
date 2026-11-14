"""One serialization of tool output for both the draft and the verifier prompts.

Two different caps meant the verifier judged a shorter text than the draft was written from.
"""
from __future__ import annotations

import json
from typing import Any

TOOL_OUTPUT_CHARS = 800
MAX_BOOKINGS_IN_PROMPT = 5

# Put these first: truncation used to cut totalCount off after the long products list.
COUNT_KEYS = ("totalCount", "total", "count", "totalPages", "page", "limit")


def _booking_line(b: dict) -> str:
    tests = b.get("items") or b.get("tests") or []
    when = b.get("slot") or " ".join(str(v) for v in (b.get("slotDate"), b.get("slotTime")) if v)
    return f"id={b.get('id')} | tests={', '.join(map(str, tests))} | when={when} | status={b.get('status')}"


def _counts_first(output: dict) -> dict:
    ordered = {k: output[k] for k in COUNT_KEYS if k in output}
    ordered.update({k: v for k, v in output.items() if k not in ordered})
    return ordered


def compact_tool_output(tool: str, output: Any) -> str:
    """Tool output as short lines for the prompt; bookings keep only id, tests, time and status."""
    if tool == "list_bookings":
        rows = output.get("bookings", []) if isinstance(output, dict) else output
        if isinstance(rows, list):
            return "\n".join(_booking_line(b) for b in rows[:MAX_BOOKINGS_IN_PROMPT] if isinstance(b, dict))
    if isinstance(output, dict):
        output = _counts_first(output)
    return json.dumps(output, default=str)[:TOOL_OUTPUT_CHARS]
