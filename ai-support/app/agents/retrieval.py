"""Retrieval Agent — RAG over catalog + knowledge base using pgvector."""
from __future__ import annotations

import logging
from typing import Any

from langfuse.decorators import observe

from app.ingestion.embeddings import generate_embedding
from app.models import RetrievalResult, RetrievedChunk

logger = logging.getLogger(__name__)

TOP_K = 5


@observe(name="retrieval-agent")
async def retrieve(query: str, db: Any, settings: Any) -> RetrievalResult:
    """Retrieve relevant knowledge chunks for a user query.

    1. Generate embedding for the query
    2. Cosine similarity search via pgvector
    3. Filter by relevance threshold (grounded abstention gate)
    4. Return top-K results

    If NO chunk clears the relevance threshold, should_abstain=True.
    """
    logger.info("Retrieving chunks for query: %s", query[:80])

    try:
        embedding = await generate_embedding(query, settings)
        threshold = settings.relevance_threshold

        raw_results = await db.vector_search(embedding, limit=TOP_K * 2)

        chunks: list[RetrievedChunk] = []
        max_similarity = 0.0

        for row in raw_results:
            similarity = row.get("similarity", 0.0)
            if similarity >= threshold:
                chunks.append(
                    RetrievedChunk(
                        id=row["id"],
                        source=row.get("source", "unknown"),
                        title=row.get("title", ""),
                        content=row.get("content", ""),
                        similarity=similarity,
                        metadata=row.get("metadata"),
                    )
                )
                if similarity > max_similarity:
                    max_similarity = similarity

        should_abstain = len(chunks) == 0

        return RetrievalResult(
            chunks=chunks[:TOP_K],
            should_abstain=should_abstain,
            max_similarity=max_similarity,
            query_embedding=embedding,
        )

    except Exception:
        logger.exception("Error in retrieval agent")
        return RetrievalResult(chunks=[], should_abstain=True, max_similarity=0.0)
