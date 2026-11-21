"""Retrieval Agent — hybrid RAG: pgvector + BM25, merged by reciprocal rank fusion."""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from google.genai import errors
from langfuse import observe

from app.agents.keyword import rrf_fuse
from app.agents.llm import AIBusyError
from app.ingestion.embeddings import QUERY, generate_embedding
from app.models import RetrievalResult, RetrievedChunk
from app.observability import annotate

logger = logging.getLogger(__name__)

TOP_K = 5
CANDIDATES = 20
# Shared-test index chunks ("packages that include B12") get their own lane: ranked with the items they
# outranked single-test chunks (real-catalog search MRR 0.94 -> 0.84), so the best one is appended instead.
INDEX_SOURCE = "catalog_index"


def _chunk(row: dict[str, Any], dense_sim: dict[str, float]) -> RetrievedChunk:
    return RetrievedChunk(
        id=row["id"],
        source=row.get("source", "unknown"),
        title=row.get("title", ""),
        content=row.get("content", ""),
        similarity=dense_sim.get(row["id"], 0.0),
        metadata=row.get("metadata"),
    )


@observe(name="retrieval-agent", capture_input=False, capture_output=False)
async def retrieve(query: str, db: Any, settings: Any) -> RetrievalResult:
    """Retrieve relevant knowledge chunks for a user query.

    1. Dense search via pgvector, filtered by relevance threshold (abstention gate)
    2. BM25 keyword search over the same chunks
    3. Fuse both rankings with RRF and return top-K
    4. Append the best shared-test index chunk ("packages that include X"), ranked in its own lane

    If NO chunk clears the relevance threshold, should_abstain=True.
    """
    logger.info("Retrieving chunks (query %d chars)", len(query))

    try:
        embedding = await generate_embedding(query, settings, QUERY)
        threshold = settings.relevance_threshold

        # Separate searches: in one ranking the index chunks filled up to 40 of 40 slots on constituent queries.
        dense, index_hits = await asyncio.gather(
            db.vector_search(embedding, limit=CANDIDATES, exclude_source=INDEX_SOURCE),
            db.vector_search(embedding, limit=1, source=INDEX_SOURCE),
        )
        # Re-check the lane, so a backend that ignores the filter cannot mix the two.
        dense = [r for r in dense if r.get("source") != INDEX_SOURCE]
        relevant = [r for r in dense if r.get("similarity", 0.0) >= threshold]
        index = [r for r in index_hits if r.get("source") == INDEX_SOURCE and r.get("similarity", 0.0) >= threshold]
        dense_sim = {r["id"]: r.get("similarity", 0.0) for r in dense + index}
        # Abstention stays a dense-similarity decision. The one exception is the narrow rescue: a short query
        # whose rare term is in a chunk title (a bare code like "qft" embeds weakly).
        if not relevant and not index:
            rescued = await db.rare_title_search(query, limit=TOP_K) if settings.bm25_rescue_enabled else []
            if not rescued:
                return RetrievalResult(should_abstain=True, query_embedding=embedding)
            annotate(bm25_rescue=True, chunk_ids=[r["id"] for r in rescued])
            return RetrievalResult(
                chunks=[_chunk(r, dense_sim) for r in rescued],
                should_abstain=False,
                max_similarity=max((r.get("similarity", 0.0) for r in dense), default=0.0),
                query_embedding=embedding,
                rescued=True,
            )

        # BM25 only joins when the dense gate passed on the item lane; an index-only turn gets just the index.
        keyword = await db.keyword_search(query, limit=CANDIDATES) if relevant else []
        chunks = [_chunk(row, dense_sim) for row in rrf_fuse(relevant, keyword)[:TOP_K] + index[:1]]

        top_similarity = max(r["similarity"] for r in relevant + index)
        annotate(chunk_ids=[c.id for c in chunks], top_similarity=top_similarity)
        return RetrievalResult(
            chunks=chunks,
            should_abstain=False,
            max_similarity=top_similarity,
            query_embedding=embedding,
        )

    except (errors.ClientError, errors.ServerError) as exc:
        if getattr(exc, 'code', None) in (429, 503) or '503' in str(exc) or '429' in str(exc):
            raise AIBusyError from exc
        logger.exception("Error in retrieval agent")
        return RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0, failed=True)
    except Exception:
        logger.exception("Error in retrieval agent")
        return RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0, failed=True)
