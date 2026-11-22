"""Query rewrite: turn a follow-up ("how much does it cost?") into a standalone search query.

Only turns with conversation history are rewritten; a first message is searched as typed, with no
model call. The rewrite feeds retrieval only: intent, draft and verifier still see the customer's
own words, so a bad rewrite can at worst fetch the wrong chunks, never put words in their mouth.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from langfuse import observe

from app.agents.keyword import rrf_fuse
from app.agents.llm import AIBusyError, call_gemini
from app.agents.retrieval import INDEX_SOURCE, TOP_K
from app.models import AgentContext, RetrievalResult, RetrievedChunk
from app.prompts.rewrite import REWRITE_PROMPT, REWRITE_SCHEMA

logger = logging.getLogger(__name__)

# Same window the intent and draft prompts see.
REWRITE_HISTORY_MESSAGES = 6
MAX_QUERY_CHARS = 300


def _history(ctx: AgentContext) -> str:
    return "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in ctx.conversation_history[-REWRITE_HISTORY_MESSAGES:]
    )


def needs_rewrite(ctx: AgentContext) -> bool:
    return bool(ctx.conversation_history)


@observe(name="query-rewrite", capture_input=False, capture_output=False)
async def rewrite_query(message: str, ctx: AgentContext, settings: Any) -> str:
    """The message as a standalone search query; the message itself on any failure or odd output."""
    if not needs_rewrite(ctx):
        return message
    prompt = REWRITE_PROMPT.format(conversation_history=_history(ctx), query=message)
    try:
        text = await call_gemini(
            prompt=prompt,
            settings=settings,
            system_prompt="You rewrite search queries. Return valid JSON only.",
            temperature=0,
            response_json_schema=REWRITE_SCHEMA,
            stage="rewrite",
        )
        query = str(json.loads(text).get("query") or "").strip()
    except AIBusyError:
        raise
    except Exception:
        logger.warning("Query rewrite failed; searching the message as typed", exc_info=True)
        return message
    if not query or len(query) > MAX_QUERY_CHARS:
        return message
    return query


def merge_results(rewritten: RetrievalResult, original: RetrievalResult, top_k: int = TOP_K) -> RetrievalResult:
    """Both searches, one result: RRF over the two item lists, best index chunk kept in its own lane.

    The rewritten search ranks first on ties. One side abstaining or failing leaves the other; the turn
    abstains only if both did, so the dense gate keeps its meaning for each query.
    """
    usable = [r for r in (rewritten, original) if not (r.failed or r.should_abstain)]
    if len(usable) < 2:
        return usable[0] if usable else rewritten

    def lanes(r: RetrievalResult) -> tuple[list[dict], list[RetrievedChunk]]:
        items = [c.model_dump() for c in r.chunks if c.source != INDEX_SOURCE]
        return items, [c for c in r.chunks if c.source == INDEX_SOURCE]

    items_a, index_a = lanes(rewritten)
    items_b, index_b = lanes(original)
    fused = [RetrievedChunk(**row) for row in rrf_fuse(items_a, items_b)[:top_k]]
    return RetrievalResult(
        chunks=fused + (index_a or index_b)[:1],
        should_abstain=False,
        max_similarity=max(rewritten.max_similarity, original.max_similarity),
        query_embedding=rewritten.query_embedding,
        rescued=rewritten.rescued and original.rescued,
    )
