"""In-memory knowledge base for eval: same chunks and cosine score as pgvector, no Postgres."""
from __future__ import annotations

import hashlib
import json
import logging
import math
from pathlib import Path
from typing import Any

from app.agents.keyword import BM25Index
from app.ingestion.catalog_sync import format_catalog_text
from app.ingestion.embeddings import generate_embeddings_batch
from app.ingestion.static_docs import STATIC_DOCUMENTS

logger = logging.getLogger(__name__)

FIXTURES = Path(__file__).parent / "fixtures"
CACHE_PATH = Path(__file__).parent / ".cache" / "embeddings.json"


def build_chunks(catalog_path: Path = FIXTURES / "catalog.json") -> list[dict[str, Any]]:
    """Chunks shaped like KnowledgeChunk rows, built the way the ingestion jobs build them."""
    chunks = [
        {
            "id": f"{doc['source']}:{doc['title']}",
            "source": doc["source"],
            "title": doc["title"],
            "content": doc["content"],
            "metadata": {"source": doc["source"]},
        }
        for doc in STATIC_DOCUMENTS
    ]
    for item in json.loads(catalog_path.read_text())["items"]:
        chunks.append(
            {
                "id": f"catalog:{item['id']}",
                "source": "catalog",
                "title": item["name"],
                "content": format_catalog_text(item),
                "metadata": {
                    "name": item["name"],
                    "type": item["type"],
                    "displayPrice": item.get("displayPrice"),
                    "discountedPrice": item.get("discountedPrice"),
                },
            }
        )
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class EmbeddingCache:
    """Disk cache keyed by model + text hash, so reruns don't re-pay for embeddings."""

    def __init__(self, settings: Any, path: Path = CACHE_PATH) -> None:
        self.settings = settings
        self.path = path
        self.data: dict[str, list[float]] = json.loads(path.read_text()) if path.exists() else {}

    def _key(self, text: str) -> str:
        raw = f"{self.settings.embedding_model}:{self.settings.embedding_dimensions}:{text}"
        return hashlib.sha256(raw.encode()).hexdigest()

    async def embed_many(self, texts: list[str]) -> list[list[float]]:
        missing = [t for t in dict.fromkeys(texts) if self._key(t) not in self.data]
        if missing:
            logger.info("Embedding %d new texts", len(missing))
            vectors = await generate_embeddings_batch(missing, self.settings)
            for text, vec in zip(missing, vectors):
                self.data[self._key(text)] = vec
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(json.dumps(self.data))
        return [self.data[self._key(t)] for t in texts]

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_many([text]))[0]


class InMemoryKnowledgeBase:
    """Stands in for Database in eval runs; exposes the same vector_search() and keyword_search()."""

    def __init__(self, chunks: list[dict[str, Any]], embeddings: list[list[float]]) -> None:
        self.chunks = chunks
        self.embeddings = embeddings
        self.bm25 = BM25Index(chunks)
        self.pool = None

    @classmethod
    async def load(cls, cache: EmbeddingCache) -> InMemoryKnowledgeBase:
        chunks = build_chunks()
        return cls(chunks, await cache.embed_many([c["content"] for c in chunks]))

    async def vector_search(self, embedding: list[float], limit: int = 10) -> list[dict[str, Any]]:
        scored = [
            {**chunk, "similarity": _cosine(embedding, vec)}
            for chunk, vec in zip(self.chunks, self.embeddings)
        ]
        scored.sort(key=lambda r: r["similarity"], reverse=True)
        return scored[:limit]

    async def keyword_search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        return self.bm25.search(query, limit)
