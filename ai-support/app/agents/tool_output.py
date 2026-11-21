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


CATALOG_TOOLS = ("search_catalog", "get_product_details")
# Room for a full 87-test package; raw JSON cut at 800 chars lost every test after the ~20th.
CATALOG_OUTPUT_CHARS = 4000


def _product_line(p: dict) -> str:
    """One product with every fact a customer asks about; works for list items and the detail payload."""
    summary = p.get("detailsSummary") if isinstance(p.get("detailsSummary"), dict) else {}
    details = p.get("detailsData") if isinstance(p.get("detailsData"), dict) else {}
    price = p.get("price") or p.get("discountedPrice") or p.get("displayPrice")
    mrp = p.get("mrp") or (p.get("displayPrice") if p.get("discountedPrice") else None)
    fields = [f"name={p.get('name')}", f"type={p.get('type')}", f"code={p.get('partnerCode')}"]
    if price:
        fields.append(f"price=₹{price}" + (f" (MRP ₹{mrp})" if mrp and mrp != price else ""))
    fasting = summary.get("fastingLabel") or " ".join(
        str(v) for v in (details.get("fasting"), details.get("fastingTime")) if v
    )
    if fasting:
        fields.append(f"fasting={fasting}")
    report = summary.get("reportingTime") or p.get("reportTime") or details.get("reportingTime")
    if report:
        fields.append(f"report_time={report}")

    names = [c.get("name") for c in details.get("constituents") or [] if isinstance(c, dict) and c.get("name")]
    if names:
        fields.append(f"tests ({len(names)}, full list)={', '.join(names)}")
    elif summary.get("constituentsPreview"):
        preview = ", ".join(summary["constituentsPreview"])
        more = summary.get("remainingConstituents") or 0
        # Search results carry a 6-test preview; say so, or "not in the list" reads as "not included".
        tail = f"; plus {more} more not shown here, so absence from this list does not mean not included" if more else ""
        fields.append(f"tests ({summary.get('testCount')})={preview}{tail}")
    return " | ".join(fields)


def _catalog_output(output: Any) -> str | None:
    if not isinstance(output, dict):
        return None
    if isinstance(output.get("products"), list):
        counts = " | ".join(f"{k}={output[k]}" for k in COUNT_KEYS if k in output)
        lines = [_product_line(p) for p in output["products"] if isinstance(p, dict)]
        return "\n".join(([counts] if counts else []) + (lines or ["no products found"]))
    if output.get("name"):
        return _product_line(output)
    return None


def compact_tool_output(tool: str, output: Any) -> str:
    """Tool output as short lines for the prompt; bookings keep only id, tests, time and status."""
    if tool in CATALOG_TOOLS:
        text = _catalog_output(output)
        if text is not None:
            return text[:CATALOG_OUTPUT_CHARS]
    if tool == "list_bookings":
        rows = output.get("bookings", []) if isinstance(output, dict) else output
        if isinstance(rows, list):
            return "\n".join(_booking_line(b) for b in rows[:MAX_BOOKINGS_IN_PROMPT] if isinstance(b, dict))
    if isinstance(output, dict):
        output = _counts_first(output)
    return json.dumps(output, default=str)[:TOOL_OUTPUT_CHARS]
