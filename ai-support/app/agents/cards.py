"""Product cards built from catalog tool output, never from the model's text.

Cards are collected from the turn's actions and attached once, at the end of the turn,
so a re-asked question re-uses real catalog rows and prices always come from Express.
"""
from __future__ import annotations

import asyncio
from typing import Any

from app.models import ActionResult, Intent, ProductCard, RetrievedChunk
from app.symptoms.safety import normalize

MAX_CARDS = 4
CATALOG_TOOLS = ("search_catalog", "get_product_details")


def _card(row: Any) -> ProductCard | None:
    if not isinstance(row, dict) or not row.get("partnerCode") or not row.get("name"):
        return None
    price = row.get("price", row.get("discountedPrice") or row.get("displayPrice"))
    if not isinstance(price, (int, float)) or price <= 0:
        return None  # a card without a real price would invite a wrong cart line
    mrp = row.get("mrp")
    return ProductCard(
        code=str(row["partnerCode"]),
        name=str(row["name"]),
        type=str(row.get("type") or "TEST"),
        price=float(price),
        mrp=float(mrp) if isinstance(mrp, (int, float)) and mrp > price else None,
        sample_type=row.get("sampleType") or None,
        report_time=row.get("reportTime") or None,
    )


def _named_in(title: str, reply: str) -> bool:
    """The reply names this product: its first three title words appear in order (replies shorten long names)."""
    words = normalize(title).split()[:3]
    return bool(words) and f" {' '.join(words)} " in normalize(reply)


async def live_cards_for_chunks(chunks: list[RetrievedChunk], reply: str, ctx: Any, settings: Any) -> list[ProductCard]:
    """Cards for catalog products the reply names, re-read live so the price is never the stored one."""
    from app.agents.action import execute_action

    codes = list(dict.fromkeys(
        c.metadata["partnerCode"] for c in chunks
        if c.source == "catalog" and isinstance(c.metadata, dict) and c.metadata.get("partnerCode") and _named_in(c.title, reply)
    ))[:MAX_CARDS]
    if not codes:
        return []
    lookups = [
        Intent(intent="PRODUCT_DETAILS", tool_name="get_product_details", parameters={"code": code}, requires_action=True)
        for code in codes
    ]
    results = await asyncio.gather(*(execute_action(i, ctx, settings) for i in lookups), return_exceptions=True)
    return cards_from_actions([r for r in results if isinstance(r, ActionResult)])


def cards_from_actions(actions: list[ActionResult], limit: int = MAX_CARDS) -> list[ProductCard]:
    """Up to MAX_CARDS unique products from successful catalog tool calls, in result order."""
    cards: list[ProductCard] = []
    seen: set[str] = set()
    for action in actions:
        if action.tool not in CATALOG_TOOLS or not action.success:
            continue
        output = action.output
        rows = output.get("products", [output]) if isinstance(output, dict) else output
        for row in rows if isinstance(rows, list) else []:
            card = _card(row)
            if card and card.code not in seen:
                seen.add(card.code)
                cards.append(card)
    return cards[:limit]
