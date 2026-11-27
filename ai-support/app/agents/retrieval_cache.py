"""Retrieval cache: the same search query returns the same chunks until the knowledge base changes.

This caches retrieval results, never answers (see AI_ROADMAP.md "Standing decisions"): the draft and
the verifier still run on every turn, and live prices still come from the catalog cards.

Invalidation is push-based (app/database.py): an ingestion run that wrote chunks, from any process,
ends with one pg_notify('kb_changed'). The service's listener connection receives it, clears this cache
and bumps the knowledge-base version that every lookup passes in, so an entry filled from the old
knowledge base by a search still in flight is never served under the new version. While the listener
is connected, a lookup costs no database query. While it is down, the version falls back to the
TTL'd row count and newest "updatedAt" of KnowledgeChunk (the same token the BM25 index uses).
"""
from __future__ import annotations

import re
from collections import OrderedDict
from dataclasses import dataclass, field
from typing import Any, Hashable

from app.models import RetrievalResult

_SPACE = re.compile(r"\s+")


def normalize(query: str) -> str:
    """Case and spacing only; any other difference in the text is a different search."""
    return _SPACE.sub(" ", query).strip().casefold()


def settings_key(settings: Any) -> tuple:
    """Everything besides the query that changes what retrieve() returns."""
    return tuple(
        getattr(settings, name, None)
        for name in (
            "embedding_model", "embedding_dimensions", "relevance_threshold", "bm25_rescue_enabled",
            "rerank_enabled", "rerank_min_score", "rerank_candidates", "rerank_model",
        )
    )


@dataclass
class RetrievalCache:
    max_entries: int = 512
    version: Hashable | None = None
    entries: OrderedDict[tuple, RetrievalResult] = field(default_factory=OrderedDict)
    hits: int = 0
    misses: int = 0
    invalidations: int = 0

    def clear(self) -> None:
        """Drop every entry now (a kb_changed notify); counted like a version change."""
        if self.entries:
            self.invalidations += 1
        self.entries.clear()

    def _sync(self, version: Hashable) -> None:
        if version != self.version:
            if self.entries:
                self.invalidations += 1
            self.entries.clear()
            self.version = version

    def get(self, query: str, settings: Any, version: Hashable) -> RetrievalResult | None:
        self._sync(version)
        key = (normalize(query), settings_key(settings))
        result = self.entries.get(key)
        if result is None:
            self.misses += 1
            return None
        self.entries.move_to_end(key)
        self.hits += 1
        return result.model_copy(deep=True)

    def put(self, query: str, settings: Any, version: Hashable, result: RetrievalResult) -> None:
        # Failures are never cached: the next turn must try the search again.
        if result.failed or self.max_entries <= 0:
            return
        self._sync(version)
        self.entries[(normalize(query), settings_key(settings))] = result.model_copy(deep=True)
        self.entries.move_to_end((normalize(query), settings_key(settings)))
        while len(self.entries) > self.max_entries:
            self.entries.popitem(last=False)

    def stats(self) -> dict[str, Any]:
        total = self.hits + self.misses
        return {"hits": self.hits, "misses": self.misses, "hit_rate": self.hits / total if total else None,
                "entries": len(self.entries), "invalidations": self.invalidations}
