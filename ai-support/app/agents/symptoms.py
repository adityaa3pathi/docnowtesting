"""Symptom turns: the model only picks a topic; tests come from the approved table, prices from the catalog."""
from __future__ import annotations

import asyncio
from typing import Any

from app.agents.cards import cards_from_actions
from app.models import ActionResult, AgentContext, Intent, ProductCard
from app.observability import annotate
from app.symptoms.safety import DISCLAIMER, normalize, topics

MAX_SYMPTOM_CARDS = 6


def _matches(term: str, action: ActionResult) -> ActionResult:
    """Keep only catalog rows whose name contains the search term as whole words (no loose hits)."""
    rows = action.output.get("products", []) if action.success and isinstance(action.output, dict) else []
    keep = [r for r in rows if isinstance(r, dict) and normalize(term) in normalize(str(r.get("name", "")))]
    return action.model_copy(update={"output": {"products": keep[:1]}})


async def symptom_reply(intent: Intent, ctx: AgentContext, settings: Any) -> tuple[str, list[ActionResult], list[ProductCard]]:
    from app.agents.action import execute_action

    table = topics()
    topic_id = intent.parameters.get("symptom_topic")
    topic = table.get(topic_id)
    annotate(symptom_flow="suggest", symptom_topic=topic_id if topic else "other")
    if not topic:
        labels = "; ".join(t["label"] for t in table.values())
        return (f"I can suggest tests people often take for: {labels}. Which one is closest to how you feel?\n\n{DISCLAIMER}", [], [])

    terms = list(dict.fromkeys(t["search"] for t in topic["tests"]))
    searches = [
        Intent(intent="CATALOG_SEARCH", tool_name="search_catalog", parameters={"search": term, "limit": 3}, requires_action=True)
        for term in terms
    ]
    results = await asyncio.gather(*(execute_action(s, ctx, settings) for s in searches))
    actions = [_matches(term, r) for term, r in zip(terms, results)]
    cards = cards_from_actions(actions, limit=MAX_SYMPTOM_CARDS)

    lines = [f"Tests often checked when people have {topic['label']}:"]
    if not cards:
        lines.append(", ".join(t["name"] for t in topic["tests"]) + ". You can search for them on DocNow.")
    if topic.get("note"):
        lines.append(topic["note"])
    lines.append(DISCLAIMER)
    return ("\n\n".join(lines), actions, cards)
