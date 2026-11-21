"""Retrieval metrics on chunk ids, scored without any LLM.

Binary relevance: a chunk is relevant if its id is in the query's `relevant` list.
"""
from __future__ import annotations

import math
from typing import Iterable, Optional


def recall_at_k(ranked: list[str], relevant: Iterable[str], k: int) -> float:
    """Share of the relevant chunks that appear in the top k."""
    relevant = set(relevant)
    return len(relevant & set(ranked[:k])) / len(relevant) if relevant else 0.0


def hit_at_k(ranked: list[str], relevant: Iterable[str], k: int) -> float:
    """1.0 if any relevant chunk is in the top k."""
    return 1.0 if set(relevant) & set(ranked[:k]) else 0.0


def reciprocal_rank(ranked: list[str], relevant: Iterable[str], k: Optional[int] = None) -> float:
    """1 / rank of the first relevant chunk, 0 if none in the top k."""
    relevant = set(relevant)
    for rank, chunk_id in enumerate(ranked[:k] if k else ranked, start=1):
        if chunk_id in relevant:
            return 1.0 / rank
    return 0.0


def ndcg_at_k(ranked: list[str], relevant: Iterable[str], k: int) -> float:
    """Normalised DCG: rewards relevant chunks placed higher; 1.0 is the ideal order."""
    relevant = set(relevant)
    if not relevant:
        return 0.0
    dcg = sum(1.0 / math.log2(rank + 1) for rank, cid in enumerate(ranked[:k], start=1) if cid in relevant)
    ideal = sum(1.0 / math.log2(rank + 1) for rank in range(1, min(len(relevant), k) + 1))
    return dcg / ideal


def mean(values: list[float]) -> Optional[float]:
    return sum(values) / len(values) if values else None
