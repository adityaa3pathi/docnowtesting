"""Retrieval-only eval: runs retrieve() on the retrieval set and scores chunk ids. No LLM calls.

Usage:
    python -m app.eval.retrieval_runner --label baseline         # embeds anything new, writes a report
    python -m app.eval.retrieval_runner --offline --gate         # CI: cached vectors only, fail on regression
    python -m app.eval.retrieval_runner --update-baseline        # accept these scores as the new baseline

Stage diagnostics explain a miss:
    in dense/BM25 top-20 but not final top-5  -> ordering problem (a reranker can fix it)
    in neither top-20                         -> recall problem (chunk text, query rewriting)
    answerable but abstained                  -> the dense threshold gate fired
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from unittest.mock import patch

from app.agents.retrieval import CANDIDATES, INDEX_SOURCE, TOP_K, retrieve
from app.config import Settings
from app.eval.corpus import REAL_DIR, EmbeddingCache, InMemoryKnowledgeBase, MissingEmbeddingsError
from app.eval.ir_metrics import hit_at_k, mean, ndcg_at_k, recall_at_k, reciprocal_rank
from app.eval.rerank_cache import PATHS as RERANK_PATHS
from app.eval.rerank_cache import RerankCache

EVAL_DIR = Path(__file__).parent
SET_PATH = EVAL_DIR / "retrieval_set.json"
BASELINE_PATH = EVAL_DIR / "retrieval_baseline.json"
# Committed, so CI scores retrieval with no API key. Query and chunk vectors both live here.
CACHE_PATH = EVAL_DIR / "fixtures" / "retrieval_embeddings.json"
REPORTS_DIR = EVAL_DIR / "reports" / "retrieval"
# The real corpus keeps every artefact next to its gitignored snapshot (it names partner products and prices).
PATHS = {
    "fixture": {"set": SET_PATH, "baseline": BASELINE_PATH, "cache": CACHE_PATH, "reports": REPORTS_DIR},
    "real": {
        "set": REAL_DIR / "retrieval_set.json",
        "baseline": REAL_DIR / "retrieval_baseline.json",
        "cache": REAL_DIR / "embeddings.json",
        "reports": REAL_DIR / "reports",
    },
}
IST = timezone(timedelta(hours=5, minutes=30))

# Gate on drops from the committed baseline, not absolute bars: the set is built to contain known misses.
GATED = {
    "recall@5": "higher",
    "mrr@5": "higher",
    "ndcg@5": "higher",
    "abstention_accuracy": "higher",
    "false_abstention_rate": "lower",
}
TOLERANCE = 0.02


async def run_queries(
    queries: list[dict], kb: InMemoryKnowledgeBase, cache: EmbeddingCache, settings: Settings,
    rerank_cache: Optional[RerankCache] = None,
) -> list[dict]:
    rows = []
    rerank_patch = patch("app.agents.rerank.score_documents", rerank_cache.score) if rerank_cache else contextlib.nullcontext()
    with patch("app.agents.retrieval.generate_embedding", lambda text, _s, _task: cache.embed(text)), rerank_patch:
        for q in queries:
            embedding = await cache.embed(q["query"])
            dense = await kb.vector_search(embedding, limit=CANDIDATES, exclude_source=INDEX_SOURCE)
            index_top = await kb.vector_search(embedding, limit=1, source=INDEX_SOURCE)
            keyword = await kb.keyword_search(q["query"], limit=CANDIDATES)
            result = await retrieve(q["query"], kb, settings)
            if result.failed:
                raise RuntimeError(f"retrieve() failed on {q['id']}; see the log above")
            rows.append(
                {
                    "id": q["id"],
                    "category": q["category"],
                    "query": q["query"],
                    "relevant": q["relevant"],
                    "final": [c.id for c in result.chunks],
                    "abstained": result.should_abstain,
                    "rescued": result.rescued,
                    "rerank_top_score": result.rerank_top_score,
                    # What the abstention gate sees: the best of both lanes.
                    "top_dense_similarity": round(max(r["similarity"] for r in dense + index_top), 4) if dense else 0.0,
                    "dense_top20": [r["id"] for r in dense],
                    "bm25_top20": [r["id"] for r in keyword],
                }
            )
    return rows


def _index_only(r: dict) -> bool:
    return all(cid.startswith(f"{INDEX_SOURCE}:") for cid in r["relevant"])


def score(rows: list[dict]) -> dict[str, Any]:
    answerable = [r for r in rows if r["relevant"]]
    # Index chunks sit after the item top 5 by design, so list queries are scored by context recall only.
    item_lane = [r for r in answerable if not _index_only(r)]
    off_topic = [r for r in rows if not r["relevant"]]

    def ir(subset: list[dict]) -> dict[str, Optional[float]]:
        return {
            "recall@5": mean([recall_at_k(r["final"], r["relevant"], TOP_K) for r in subset]),
            "hit@1": mean([hit_at_k(r["final"], r["relevant"], 1) for r in subset]),
            "mrr@5": mean([reciprocal_rank(r["final"], r["relevant"], TOP_K) for r in subset]),
            "ndcg@5": mean([ndcg_at_k(r["final"], r["relevant"], TOP_K) for r in subset]),
            # Everything the draft sees: the item top 5 plus the appended index chunk.
            "context_recall": mean([recall_at_k(r["final"], r["relevant"], len(r["final"])) for r in subset]),
        }

    def miss_kind(r: dict) -> Optional[str]:
        if recall_at_k(r["final"], r["relevant"], len(r["final"])) == 1.0:
            return None
        if r["abstained"]:
            return "abstained"
        in_candidates = set(r["relevant"]) & (set(r["dense_top20"]) | set(r["bm25_top20"]))
        return "ordering" if in_candidates - set(r["final"]) else "not_found"

    misses = defaultdict(list)
    for r in answerable:
        kind = miss_kind(r)
        if kind:
            misses[kind].append(r["id"])

    by_category: dict[str, dict] = {}
    for cat in sorted({r["category"] for r in answerable}):
        subset = [r for r in answerable if r["category"] == cat]
        by_category[cat] = {"n": len(subset), **ir(subset)}

    # Off-topic must abstain; not_offered must abstain or (once the doc exists) retrieve it.
    abstention_by_category = {
        cat: mean([1.0 if r["abstained"] else 0.0 for r in off_topic if r["category"] == cat])
        for cat in sorted({r["category"] for r in off_topic})
    }

    answer_sims = [r["top_dense_similarity"] for r in answerable]
    off_sims = [r["top_dense_similarity"] for r in off_topic]
    return {
        "n_answerable": len(answerable),
        "n_off_topic": len(off_topic),
        **ir(item_lane),
        "context_recall": mean([recall_at_k(r["final"], r["relevant"], len(r["final"])) for r in answerable]),
        "dense_recall@20": mean([recall_at_k(r["dense_top20"], r["relevant"], CANDIDATES) for r in item_lane]),
        "bm25_recall@20": mean([recall_at_k(r["bm25_top20"], r["relevant"], CANDIDATES) for r in item_lane]),
        "false_abstention_rate": mean([1.0 if r["abstained"] else 0.0 for r in answerable]),
        "abstention_accuracy": mean([1.0 if r["abstained"] else 0.0 for r in off_topic]),
        # The threshold sits safely only if every answerable query scores above every off-topic one.
        "answerable_top_sim_min": min(answer_sims) if answer_sims else None,
        "off_topic_top_sim_max": max(off_sims) if off_sims else None,
        "abstention_by_category": abstention_by_category,
        # Where the rare-title rescue fired: answerable ids it saved, off-topic ids it let through.
        "rescued": {
            "answerable": [r["id"] for r in answerable if r.get("rescued")],
            "off_topic": [r["id"] for r in off_topic if r.get("rescued")],
        },
        "misses": dict(misses),
        "by_category": by_category,
    }


SWEEP = [0.005, 0.01, 0.02, 0.03, 0.05, 0.08, 0.1, 0.15, 0.2, 0.3]


def gate_sweep(rows: list[dict]) -> list[dict]:
    """What each reranker gate threshold would do, from one ungated run: pick rerank_min_score from this.

    A row abstains at threshold t if the dense gate abstained, or its best reranker score is below t.
    """
    answerable = [r for r in rows if r["relevant"]]
    off_topic = [r for r in rows if not r["relevant"]]

    def abstains(r: dict, t: float) -> bool:
        return r["abstained"] or (r.get("rerank_top_score") is not None and r["rerank_top_score"] < t)

    return [
        {
            "threshold": t,
            "false_abstention_rate": mean([1.0 if abstains(r, t) else 0.0 for r in answerable]),
            "abstention_accuracy": mean([1.0 if abstains(r, t) else 0.0 for r in off_topic]),
            "false_abstentions": [r["id"] for r in answerable if abstains(r, t) and not r["abstained"]],
        }
        for t in SWEEP
    ]


def regressions(scores: dict, baseline: dict) -> list[str]:
    failed = []
    for metric, direction in GATED.items():
        new, old = scores.get(metric), baseline.get(metric)
        if new is None or old is None:
            continue
        worse = old - new if direction == "higher" else new - old
        if worse > TOLERANCE:
            failed.append(f"{metric}: {old:.3f} -> {new:.3f}")
    return failed


def validate(queries: list[dict], chunk_ids: set[str]) -> list[str]:
    """Labels that point at no chunk would silently score as misses."""
    return [f"{q['id']}: {cid}" for q in queries for cid in q["relevant"] if cid not in chunk_ids]


def print_summary(scores: dict, baseline: Optional[dict]) -> None:
    flat = {k: v for k, v in scores.items() if not isinstance(v, (dict, list))}
    print(f"\n{'Metric':<24} | {'Score':>7} | {'Baseline':>8}")
    print("-" * 46)
    for metric, value in flat.items():
        old = (baseline or {}).get(metric)
        fmt = lambda v: "n/a" if v is None else (f"{v}" if isinstance(v, int) else f"{v:.3f}")
        print(f"{metric:<24} | {fmt(value):>7} | {fmt(old) if baseline else '':>8}")
    print(f"\n{'Category':<16} | {'n':>3} | {'R@5':>5} | {'MRR':>5} | {'nDCG':>5} | {'ctxR':>5}")
    for cat, m in scores["by_category"].items():
        print(f"{cat:<16} | {m['n']:>3} | {m['recall@5']:.2f} | {m['mrr@5']:.2f} | {m['ndcg@5']:.2f} | {m['context_recall']:.2f}")
    for row in scores.get("rerank_gate_sweep", []):
        print(f"gate {row['threshold']:<5} false_abst {row['false_abstention_rate']:.3f}  "
              f"abst_acc {row['abstention_accuracy']:.3f}  {', '.join(row['false_abstentions'][:4])}")
    for cat, acc in scores.get("abstention_by_category", {}).items():
        print(f"abstention/{cat}: {acc:.2f}")
    for kind, ids in scores.get("rescued", {}).items():
        if ids:
            print(f"rescued/{kind}: {', '.join(ids)}")
    for kind, ids in scores["misses"].items():
        print(f"miss/{kind}: {', '.join(ids)}")


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    if not args.offline and not settings.gemini_api_key:
        print("SUPPORT_GEMINI_API_KEY is not set; use --offline to score from the committed cache.")
        return 2

    paths = PATHS[args.corpus]
    queries = json.loads(paths["set"].read_text())["queries"]
    cache = EmbeddingCache(settings, path=paths["cache"], offline=args.offline)
    rerank_cache = None
    if args.rerank:
        if not args.offline and not settings.cohere_api_key:
            print("--rerank needs SUPPORT_COHERE_API_KEY, or --offline with a filled rerank cache.")
            return 2
        settings.rerank_enabled = True
        settings.cohere_api_key = settings.cohere_api_key or "offline-cache"
        settings.rerank_min_score = args.rerank_min_score
        rerank_cache = RerankCache(settings, RERANK_PATHS[args.corpus], offline=args.offline, rpm=args.rerank_rpm)
    try:
        kb = await InMemoryKnowledgeBase.load(cache, args.corpus)
        bad = validate(queries, {c["id"] for c in kb.chunks})
        if bad:
            print("Unknown chunk ids in retrieval_set.json:\n  " + "\n  ".join(bad))
            return 2
        rows = await run_queries(queries, kb, cache, settings, rerank_cache)
    except MissingEmbeddingsError as exc:
        print(f"MISSING_EMBEDDINGS: {exc}")
        return 2
    if not args.offline:
        cache.save(prune=True)
    if rerank_cache:
        if rerank_cache.failures:
            print(f"RERANK_FAILED on {len(rerank_cache.failures)} queries (scores would silently be RRF):")
            print("  " + "\n  ".join(rerank_cache.failures[:5]))
            return 2
        if not args.offline:
            rerank_cache.save(prune=True)
        print(f"Reranker: {settings.rerank_model}, {rerank_cache.calls} API calls ({rerank_cache.retried} retried), "
              f"min score {settings.rerank_min_score}")

    scores = score(rows)
    if rerank_cache:
        scores["rerank_gate_sweep"] = gate_sweep(rows)
        ans = [r["rerank_top_score"] for r in rows if r["relevant"] and r.get("rerank_top_score") is not None]
        off = [r["rerank_top_score"] for r in rows if not r["relevant"] and r.get("rerank_top_score") is not None]
        scores["answerable_rerank_min"] = min(ans) if ans else None
        scores["off_topic_rerank_max"] = max(off) if off else None
    baseline = json.loads(paths["baseline"].read_text())["scores"] if paths["baseline"].exists() else None
    print(f"Corpus: {len(kb.chunks)} chunks, {len(queries)} queries, threshold {settings.relevance_threshold}")
    print_summary(scores, baseline)

    now = datetime.now(IST)
    meta = {
        "label": args.label,
        "run_at_ist": now.strftime("%d-%m-%Y %H:%M IST"),
        "embedding_model": settings.embedding_model,
        "embedding_dimensions": settings.embedding_dimensions,
        "relevance_threshold": settings.relevance_threshold,
        "corpus": args.corpus,
        "corpus_chunks": len(kb.chunks),
        "rerank": settings.rerank_model if args.rerank else None,
        "rerank_min_score": settings.rerank_min_score if args.rerank else None,
    }
    if not args.offline:
        paths["reports"].mkdir(parents=True, exist_ok=True)
        path = paths["reports"] / f"{now:%Y-%m-%d-%H%M}-{args.label}.json"
        path.write_text(json.dumps({**meta, "scores": scores, "rows": rows}, indent=2, ensure_ascii=False))
        print(f"\nReport saved to {path}")
    if args.update_baseline:
        paths["baseline"].write_text(json.dumps({**meta, "scores": scores}, indent=2, ensure_ascii=False) + "\n")
        print(f"Baseline updated: {paths['baseline']}")
        return 0

    if args.gate:
        if baseline is None:
            print("--gate needs a committed baseline; run with --update-baseline first.")
            return 2
        failed = regressions(scores, baseline)
        if failed:
            print("\nRetrieval regressed beyond tolerance:\n  " + "\n  ".join(failed))
            print("If the drop is intended, run --update-baseline and explain it in the PR.")
            return 1
        print("\nRetrieval gate passed.")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Score retrieval alone on the retrieval set")
    parser.add_argument("--label", default="run")
    parser.add_argument("--corpus", choices=["fixture", "real"], default="fixture",
                        help="real = local production catalog snapshot (gitignored, no CI)")
    parser.add_argument("--offline", action="store_true", help="use only cached embeddings; never call Gemini")
    parser.add_argument("--gate", action="store_true", help="exit 1 if a metric drops past tolerance vs baseline")
    parser.add_argument("--rerank", action="store_true", help="rerank with Cohere (cached; see rerank_cache.py)")
    parser.add_argument("--rerank-min-score", type=float, default=0.0, help="reranker gate; 0 = off")
    parser.add_argument("--rerank-rpm", type=int, default=0, help="pace Cohere calls (trial key: 10)")
    parser.add_argument("--update-baseline", action="store_true", help="write these scores to retrieval_baseline.json")
    logging.basicConfig(level=logging.WARNING)
    # Langfuse is off in eval and warns once per traced call about the missing key.
    logging.getLogger("langfuse").setLevel(logging.ERROR)
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
