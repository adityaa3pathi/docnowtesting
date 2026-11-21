"""Disk cache of reranker scores per (model, query, document), so evals pay Cohere once.

The fixture cache is committed like the embedding cache, so CI can score the reranker with no key.
A trial key allows about 10 rerank calls a minute; --rerank-rpm paces the first run.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import time
from pathlib import Path
from typing import Any

from app.agents.rerank import cohere_rerank
from app.eval.corpus import FIXTURES, REAL_DIR

PATHS = {"fixture": FIXTURES / "rerank_scores.json", "real": REAL_DIR / "rerank_scores.json"}


class MissingRerankScoresError(RuntimeError):
    """An offline cache was asked for a (query, document) pair it has no score for."""


class RerankCache:
    def __init__(self, settings: Any, path: Path, offline: bool = False, rpm: int = 0) -> None:
        self.settings = settings
        self.path = path
        self.offline = offline
        self.min_interval = 60 / rpm if rpm else 0.0
        self.data: dict[str, float] = json.loads(path.read_text()) if path.exists() else {}
        self.used: set[str] = set()
        self.calls = 0
        # rerank() swallows errors and falls back to RRF by design; in an eval that would silently score
        # "reranker off", so failures are counted here and the runner refuses to report the run.
        self.failures: list[str] = []
        self._last_call = 0.0

    def _key(self, query: str, doc: str) -> str:
        return hashlib.sha256(f"{self.settings.rerank_model}\0{query}\0{doc}".encode()).hexdigest()

    async def score(self, query: str, documents: list[str], settings: Any) -> list[float]:
        try:
            return await self._score(query, documents, settings)
        except Exception as exc:
            self.failures.append(f"{query!r}: {exc!r}")
            raise

    async def _score(self, query: str, documents: list[str], settings: Any) -> list[float]:
        keys = [self._key(query, d) for d in documents]
        missing = [d for d, k in zip(documents, keys) if k not in self.data]
        if missing:
            if self.offline:
                raise MissingRerankScoresError(
                    f"{len(missing)} documents have no cached rerank score for {query!r} in {self.path}. "
                    "Rerun without --offline (needs SUPPORT_COHERE_API_KEY)."
                )
            wait = self._last_call + self.min_interval - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            self._last_call = time.monotonic()
            self.calls += 1
            for doc, value in zip(missing, await cohere_rerank(query, missing, settings)):
                self.data[self._key(query, doc)] = round(value, 6)
            self.save()
        self.used.update(keys)
        return [self.data[k] for k in keys]

    def save(self, prune: bool = False) -> None:
        data = {k: v for k, v in self.data.items() if k in self.used} if prune else self.data
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(data, separators=(",", ":"), sort_keys=True))
