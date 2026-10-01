"""Gemini embedding generation utility."""
from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.config import Settings

logger = logging.getLogger(__name__)

# Module-level client cache
_client = None


def _get_client(settings: Settings):
    """Get or create a google-genai client."""
    global _client
    if _client is None:
        from google import genai

        _client = genai.Client(api_key=settings.gemini_api_key)
    return _client


async def generate_embedding(text: str, settings: Settings) -> list[float]:
    """Generate a single embedding vector using Gemini.

    Uses gemini-embedding-001 model with configurable dimensions (default 768).
    """
    client = _get_client(settings)

    try:
        response = client.models.embed_content(
            model=settings.embedding_model,
            contents=text,
            config={"output_dimensionality": settings.embedding_dimensions},
        )
        values = response.embeddings[0].values
        return list(values)
    except Exception:
        logger.exception("Failed to generate embedding for text: %s...", text[:80])
        raise


async def generate_embeddings_batch(
    texts: list[str],
    settings: Settings,
    batch_size: int = 20,
) -> list[list[float]]:
    """Generate embeddings for multiple texts in batches.

    The Gemini API supports batched embedding requests.
    """
    client = _get_client(settings)
    all_embeddings: list[list[float]] = []

    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        try:
            response = client.models.embed_content(
                model=settings.embedding_model,
                contents=batch,
                config={"output_dimensionality": settings.embedding_dimensions},
            )
            for emb in response.embeddings:
                all_embeddings.append(list(emb.values))
        except Exception:
            logger.exception("Failed to generate embeddings for batch %d", i)
            raise

    return all_embeddings
