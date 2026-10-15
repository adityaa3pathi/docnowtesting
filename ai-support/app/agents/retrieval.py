"""Retrieval Agent — hybrid RAG: pgvector + BM25, merged by reciprocal rank fusion."""
from __future__ import annotations

import logging
from typing import Any

from langfuse import observe

from app.agents.keyword import rrf_fuse
from app.ingestion.embeddings import QUERY, generate_embedding
from app.models import RetrievalResult, RetrievedChunk
from app.observability import annotate

logger = logging.getLogger(__name__)

TOP_K = 5
CANDIDATES = 20


@observe(name="retrieval-agent", capture_input=False, capture_output=False)
async def retrieve(query: str, db: Any, settings: Any) -> RetrievalResult:
    """Retrieve relevant knowledge chunks for a user query.

    1. Dense search via pgvector, filtered by relevance threshold (abstention gate)
    2. BM25 keyword search over the same chunks
    3. Fuse both rankings with RRF and return top-K

    If NO chunk clears the relevance threshold, should_abstain=True.
    """
    logger.info("Retrieving chunks (query %d chars)", len(query))

    try:
        embedding = await generate_embedding(query, settings, QUERY)
        threshold = settings.relevance_threshold

        dense = await db.vector_search(embedding, limit=CANDIDATES)
        relevant = [r for r in dense if r.get("similarity", 0.0) >= threshold]
        # Abstention stays a dense-similarity decision; BM25 only adds and reorders.
        if not relevant:
            return RetrievalResult(should_abstain=True, query_embedding=embedding)

        keyword = await db.keyword_search(query, limit=CANDIDATES)
        dense_sim = {r["id"]: r.get("similarity", 0.0) for r in dense}
        chunks = [
            RetrievedChunk(
                id=row["id"],
                source=row.get("source", "unknown"),
                title=row.get("title", ""),
                content=row.get("content", ""),
                similarity=dense_sim.get(row["id"], 0.0),
                metadata=row.get("metadata"),
            )
            for row in rrf_fuse(relevant, keyword)[:TOP_K]
        ]

        annotate(chunk_ids=[c.id for c in chunks], top_similarity=max(r["similarity"] for r in relevant))
        return RetrievalResult(
            chunks=chunks,
            should_abstain=False,
            max_similarity=max(r["similarity"] for r in relevant),
            query_embedding=embedding,
        )

    except Exception:
        logger.exception("Error in retrieval agent")
        return RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0)
