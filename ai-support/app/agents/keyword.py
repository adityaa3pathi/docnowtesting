"""BM25 keyword search and reciprocal rank fusion, for the codes dense search misses (HbA1c, LFT)."""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Any

_TOKEN = re.compile(r"[a-z0-9]+")
_STOPWORDS = frozenset(
    "a an and are be can do does for how i in is it me my of on or the this to what when where which with you your".split()
)


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN.findall(text.lower()) if t not in _STOPWORDS]


class BM25Index:
    """Okapi BM25 over chunk title + content; the corpus is small enough to keep in memory."""

    def __init__(self, chunks: list[dict[str, Any]], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1, self.b = k1, b
        self.docs = [Counter(tokenize(f"{c.get('title', '')} {c.get('content', '')}")) for c in chunks]
        self.lengths = [sum(d.values()) for d in self.docs]
        self.avg_len = (sum(self.lengths) / len(self.docs)) if self.docs else 0.0
        df = Counter(term for doc in self.docs for term in doc)
        n = len(self.docs)
        self.idf = {term: math.log(1 + (n - f + 0.5) / (f + 0.5)) for term, f in df.items()}

    def search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        terms = [t for t in dict.fromkeys(tokenize(query)) if t in self.idf]
        scored = []
        for chunk, doc, length in zip(self.chunks, self.docs, self.lengths):
            score = 0.0
            for term in terms:
                tf = doc.get(term, 0)
                if tf:
                    norm = self.k1 * (1 - self.b + self.b * length / self.avg_len)
                    score += self.idf[term] * tf * (self.k1 + 1) / (tf + norm)
            if score > 0:
                scored.append({**chunk, "bm25": score})
        scored.sort(key=lambda r: r["bm25"], reverse=True)
        return scored[:limit]


def rrf_fuse(*ranked_lists: list[dict[str, Any]], k: int = 60) -> list[dict[str, Any]]:
    """Merge ranked lists by id; k=60 is the constant from the original RRF paper."""
    scores: dict[str, float] = {}
    rows: dict[str, dict[str, Any]] = {}
    for ranked in ranked_lists:
        for rank, row in enumerate(ranked):
            scores[row["id"]] = scores.get(row["id"], 0.0) + 1 / (k + rank + 1)
            rows[row["id"]] = {**row, **rows.get(row["id"], {})}
    return [rows[i] for i in sorted(scores, key=scores.get, reverse=True)]
