"""The verifier used a 500-char cap while the draft used 800, and counts were always cut off."""
from __future__ import annotations

import json

from app.agents.tool_output import CATALOG_OUTPUT_CHARS, compact_tool_output


def _catalog_page(n: int) -> dict:
    return {
        "products": [{"name": f"Test {i}", "description": "x" * 120} for i in range(n)],
        "totalCount": 137,
        "page": 1,
        "limit": 12,
    }


def test_catalog_counts_come_first_and_survive_the_cap():
    text = compact_tool_output("search_catalog", _catalog_page(300))
    assert len(text) <= CATALOG_OUTPUT_CHARS
    assert text.splitlines()[0].startswith("totalCount=137")


def test_search_result_preview_says_more_tests_exist():
    """Express search sends a 6-test preview; the model must not read it as the whole package."""
    page = {"products": [{
        "name": "Complete Package", "type": "PACKAGE", "partnerCode": "package_1", "price": 2100, "mrp": 7800,
        "detailsSummary": {"testCount": 87, "constituentsPreview": ["Albumin", "ALP"], "remainingConstituents": 85,
                           "fastingLabel": "Required 12 hour(s)", "reportingTime": "26 hrs"},
    }], "totalCount": 1}
    line = compact_tool_output("search_catalog", page).splitlines()[1]
    assert "price=₹2100 (MRP ₹7800)" in line
    assert "fasting=Required 12 hour(s)" in line and "report_time=26 hrs" in line
    assert "plus 85 more not shown here" in line and "does not mean not included" in line


def test_product_details_keep_every_test():
    tests = [{"name": f"Test {i}"} for i in range(87)] + [{"name": "Glycated Hemoglobin (HbA1c)"}]
    detail = {"name": "Complete Package", "type": "PACKAGE", "partnerCode": "p1", "discountedPrice": 2100,
              "displayPrice": 7800, "detailsData": {"constituents": tests, "reportingTime": "26 hrs"}}
    text = compact_tool_output("get_product_details", detail)
    assert "tests (88, full list)=" in text and "Glycated Hemoglobin (HbA1c)" in text


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
