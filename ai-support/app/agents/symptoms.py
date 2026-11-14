"""Symptom turns: the model only picks a topic; tests come from the approved table, prices from the catalog."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.agents.cards import cards_from_actions
from app.models import ActionResult, AgentContext, Intent, ProductCard
from app.observability import annotate
from app.symptoms.safety import DISCLAIMER, normalize, topics

logger = logging.getLogger(__name__)
MAX_SYMPTOM_CARDS = 6


def _call(tool: str, params: dict) -> Intent:
    return Intent(intent="CATALOG_SEARCH", tool_name=tool, parameters=params, requires_action=True)


async def _live_item(code: str, name: str, ctx: AgentContext, settings: Any) -> ActionResult:
    """The pinned catalog item, re-read live; if its code differs here, an exact-name search finds it."""
    from app.agents.action import execute_action

    found = await execute_action(_call("get_product_details", {"code": code}), ctx, settings)
    if found.success and isinstance(found.output, dict) and found.output.get("partnerCode"):
        return found
    search = await execute_action(_call("search_catalog", {"search": name, "limit": 5}), ctx, settings)
    rows = search.output.get("products", []) if search.success and isinstance(search.output, dict) else []
    exact = [r for r in rows if isinstance(r, dict) and normalize(str(r.get("name", ""))) == normalize(name)]
    if not exact:
        logger.warning("symptom test not in catalog: code=%s", code)
    return search.model_copy(update={"output": {"products": exact[:1]}})


async def symptom_reply(intent: Intent, ctx: AgentContext, settings: Any) -> tuple[str, list[ActionResult], list[ProductCard]]:
    table = topics()
    topic_id = intent.parameters.get("symptom_topic")
    topic = table.get(topic_id)
    annotate(symptom_flow="suggest", symptom_topic=topic_id if topic else "other")
    if not topic:
        labels = "; ".join(t["label"] for t in table.values())
        return (f"I can suggest tests people often take for: {labels}. Which one is closest to how you feel?\n\n{DISCLAIMER}", [], [])

    items = list(dict.fromkeys((t["code"], t["catalog_name"]) for t in topic["tests"] if t.get("code")))
    results = await asyncio.gather(*(_live_item(c, n, ctx, settings) for c, n in items), return_exceptions=True)
    actions = [r for r in results if isinstance(r, ActionResult)]
    cards = cards_from_actions(actions, limit=MAX_SYMPTOM_CARDS)

    lines = [f"Tests often checked when people have {topic['label']}:"]
    shown = {normalize(c.name) for c in cards}
    others = [t["name"] for t in topic["tests"] if not t.get("code") or normalize(t["catalog_name"]) not in shown]
    others = list(dict.fromkeys(others))
    # Every approved test is named, even past the card limit or when not sold yet.
    if others:
        lines.append("Also often checked: " + ", ".join(others) + ".")
    if topic.get("note"):
        lines.append(topic["note"])
    lines.append(DISCLAIMER)
    return ("\n\n".join(lines), actions, cards)
