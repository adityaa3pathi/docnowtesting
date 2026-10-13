"""Gemini embedding generation utility."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from app.genai_client import get_genai_client

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger(__name__)

# Gemini embeds questions and stored passages differently; mixing them up hurts search.
QUERY = "RETRIEVAL_QUERY"
DOCUMENT = "RETRIEVAL_DOCUMENT"


async def generate_embedding(text: str, settings: Settings, task_type: str) -> list[float]:
    """Generate a single embedding vector using Gemini.

    Uses gemini-embedding-001 model with configurable dimensions (default 768).
    """
    client = get_genai_client(settings)

    try:
        response = await client.aio.models.embed_content(
            model=settings.embedding_model,
            contents=text,
            config={"output_dimensionality": settings.embedding_dimensions, "task_type": task_type},
        )
        values = response.embeddings[0].values
        return list(values)
    except Exception:
        logger.exception("Failed to generate embedding for text: %s...", text[:80])
        raise


async def generate_embeddings_batch(
    texts: list[str],
    settings: Settings,
    task_type: str,
    batch_size: int = 20,
) -> list[list[float]]:
    """Generate embeddings for multiple texts in batches.

    The Gemini API supports batched embedding requests.
    """
    client = get_genai_client(settings)
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        try:
            response = await client.aio.models.embed_content(
                model=settings.embedding_model,
                contents=batch,
                config={"output_dimensionality": settings.embedding_dimensions, "task_type": task_type},
            )
            for emb in response.embeddings:
                all_embeddings.append(list(emb.values))
        except Exception:
            logger.exception("Failed to generate embeddings for batch %d", i)
            raise

    return all_embeddings
