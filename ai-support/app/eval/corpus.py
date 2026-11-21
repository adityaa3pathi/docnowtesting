"""In-memory knowledge base for eval: same chunks and cosine score as pgvector, no Postgres."""
from __future__ import annotations

import hashlib
import json
import logging
import math
from pathlib import Path
from typing import Any

from app.agents.keyword import BM25Index
from app.ingestion.catalog_sync import INDEX_SOURCE, constituent_index_docs, format_catalog_text
from app.ingestion.embeddings import DOCUMENT, QUERY, generate_embeddings_batch
from app.ingestion.static_docs import STATIC_DOCUMENTS

logger = logging.getLogger(__name__)

FIXTURES = Path(__file__).parent / "fixtures"
CACHE_PATH = Path(__file__).parent / ".cache" / "embeddings.json"
# "real" is a production CatalogItem snapshot with partner pricing: gitignored, local only.
REAL_DIR = FIXTURES / "real"
CORPORA = {"fixture": FIXTURES / "catalog.json", "real": REAL_DIR / "catalog.json"}


def catalog_items(corpus: str = "fixture") -> list[dict[str, Any]]:
    path = CORPORA[corpus]
    if not path.exists():
        raise FileNotFoundError(f"{path} missing; the real corpus is exported by hand (see AI_ROADMAP.md)")
    return json.loads(path.read_text())["items"]


def build_chunks(corpus: str = "fixture") -> list[dict[str, Any]]:
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
    items = catalog_items(corpus)
    for item in items:
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
    for doc in constituent_index_docs(items):
        chunks.append(
            {
                "id": f"{INDEX_SOURCE}:{doc['source_id']}",
                "source": INDEX_SOURCE,
                "title": doc["title"],
                "content": doc["content"],
                "metadata": {"test": doc["source_id"]},
            }
        )
    return chunks


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


class MissingEmbeddingsError(RuntimeError):
    """An offline cache was asked for text it has no vector for."""


class EmbeddingCache:
    """Disk cache keyed by model + text hash, so reruns don't re-pay for embeddings.

    offline=True never calls Gemini: a miss raises, so CI fails loudly instead of needing a key.
    """

    def __init__(self, settings: Any, path: Path = CACHE_PATH, offline: bool = False) -> None:
        self.settings = settings
        self.path = path
        self.offline = offline
        self.data: dict[str, list[float]] = json.loads(path.read_text()) if path.exists() else {}
        self.used: set[str] = set()

    def _key(self, text: str, task_type: str) -> str:
        raw = f"{self.settings.embedding_model}:{self.settings.embedding_dimensions}:{task_type}:{text}"
        return hashlib.sha256(raw.encode()).hexdigest()

    async def embed_many(self, texts: list[str], task_type: str) -> list[list[float]]:
        missing = [t for t in dict.fromkeys(texts) if self._key(t, task_type) not in self.data]
        if missing:
            if self.offline:
                raise MissingEmbeddingsError(
                    f"{len(missing)} texts have no cached embedding in {self.path} "
                    f"(first: {missing[0][:60]!r}). Rerun locally without --offline to refresh the cache."
                )
            logger.info("Embedding %d new texts", len(missing))
            vectors = await generate_embeddings_batch(missing, self.settings, task_type)
            for text, vec in zip(missing, vectors):
                # 6 decimals moves cosine by ~1e-6 and halves the file, which matters once it's committed.
                self.data[self._key(text, task_type)] = [round(x, 6) for x in vec]
            self.save()
        keys = [self._key(t, task_type) for t in texts]
        self.used.update(keys)
        return [self.data[k] for k in keys]

    def save(self, prune: bool = False) -> None:
        """prune=True keeps only vectors used this run, so stale texts don't pile up in the file."""
        data = {k: v for k, v in self.data.items() if k in self.used} if prune else self.data
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True))

    async def embed(self, text: str) -> list[float]:
        return (await self.embed_many([text], QUERY))[0]


class InMemoryKnowledgeBase:
    """Stands in for Database in eval runs; exposes the same vector_search() and keyword_search()."""

    def __init__(self, chunks: list[dict[str, Any]], embeddings: list[list[float]]) -> None:
        self.chunks = chunks
        self.embeddings = embeddings
        self.bm25 = BM25Index([c for c in chunks if c.get("source") != INDEX_SOURCE])
        self.pool = None

    @classmethod
    async def load(cls, cache: EmbeddingCache, corpus: str = "fixture") -> InMemoryKnowledgeBase:
        chunks = build_chunks(corpus)
        return cls(chunks, await cache.embed_many([c["content"] for c in chunks], DOCUMENT))

    async def vector_search(
        self, embedding: list[float], limit: int = 10, *, source: str | None = None, exclude_source: str | None = None
    ) -> list[dict[str, Any]]:
        scored = [
            {**chunk, "similarity": _cosine(embedding, vec)}
            for chunk, vec in zip(self.chunks, self.embeddings)
            if (source is None or chunk.get("source") == source)
            and (exclude_source is None or chunk.get("source") != exclude_source)
        ]
        scored.sort(key=lambda r: r["similarity"], reverse=True)
        return scored[:limit]

    async def keyword_search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        return self.bm25.search(query, limit)
