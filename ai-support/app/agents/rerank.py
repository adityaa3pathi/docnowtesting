"""Cross-encoder reranking with Cohere Rerank, behind settings.rerank_enabled.

RRF only knows ranks. A cross-encoder reads query and chunk together, so it can tell that
"unsaturated iron binding capacity" means the UIBC test, not the iron packages that list it.
Any failure returns None and the caller keeps the RRF order: reranking may improve an answer,
never block one.
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

COHERE_RERANK_URL = "https://api.cohere.com/v2/rerank"
# Cohere truncates long documents itself; capping here keeps the request small and the latency flat.
DOC_CHARS = 4000


def document_text(row: dict[str, Any]) -> str:
    return f"{row.get('title', '')}\n{row.get('content', '')}"[:DOC_CHARS]


async def cohere_rerank(query: str, documents: list[str], settings: Any) -> list[float]:
    """Relevance score per document, in input order. Raises on any HTTP or shape problem."""
    async with httpx.AsyncClient(timeout=settings.rerank_timeout_seconds) as client:
        resp = await client.post(
            COHERE_RERANK_URL,
            headers={"Authorization": f"Bearer {settings.cohere_api_key}"},
            json={"model": settings.rerank_model, "query": query, "documents": documents, "top_n": len(documents)},
        )
        resp.raise_for_status()
        results = resp.json()["results"]
    scores = [0.0] * len(documents)
    for r in results:
        scores[r["index"]] = float(r["relevance_score"])
    return scores


async def rerank(query: str, rows: list[dict[str, Any]], settings: Any) -> Optional[list[tuple[dict[str, Any], float]]]:
    """Rows sorted by reranker score with their scores, or None to keep the caller's order."""
    if not rows or not settings.cohere_api_key:
        return None
    start = time.monotonic()
    try:
        scores = await score_documents(query, [document_text(r) for r in rows], settings)
    except Exception as exc:  # timeout, 429, 5xx, bad JSON: all fall back to RRF
        logger.warning("Rerank failed after %d ms, keeping RRF order: %r", (time.monotonic() - start) * 1000, exc)
        return None
    return sorted(zip(rows, scores), key=lambda pair: pair[1], reverse=True)


# The eval swaps this for a disk cache, so reruns don't spend the trial key's 10 calls a minute.
score_documents = cohere_rerank
