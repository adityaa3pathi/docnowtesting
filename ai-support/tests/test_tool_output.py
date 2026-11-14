"""The verifier used a 500-char cap while the draft used 800, and counts were always cut off."""
from __future__ import annotations

import json

from app.agents.tool_output import TOOL_OUTPUT_CHARS, compact_tool_output


def _catalog_page(n: int) -> dict:
    return {
        "products": [{"name": f"Test {i}", "description": "x" * 120} for i in range(n)],
        "totalCount": 137,
        "page": 1,
        "limit": 12,
    }


def test_total_count_survives_truncation():
    text = compact_tool_output("search_catalog", _catalog_page(30))
    assert len(text) == TOOL_OUTPUT_CHARS
    assert text.index('"totalCount"') < text.index('"products"')
    assert "137" in text


def test_draft_and_verifier_see_the_same_text():
    """Both prompts now build action text through this one function."""
    from app.agents import verifier
    from app.agents.orchestrator import compact_tool_output as draft_fn

    assert draft_fn is verifier.compact_tool_output is compact_tool_output


def test_bookings_stay_as_short_lines():
    output = {"bookings": [{"id": "b1", "tests": ["CBC"], "slot": "10:00", "status": "BOOKED"}]}
    assert compact_tool_output("list_bookings", output) == (
        "id=b1 | tests=CBC | when=10:00 | status=BOOKED"
    )


def test_non_dict_output_is_still_serialized():
    assert json.loads(compact_tool_output("get_product_details", [1, 2, 3])) == [1, 2, 3]
