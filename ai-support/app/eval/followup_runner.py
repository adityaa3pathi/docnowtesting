"""Retrieval on multi-turn follow-ups: the message as typed vs the rewritten query vs both, fused.

    python -m app.eval.followup_runner --repeat 5 --label phase4-rewrite

The rewrite is a Gemini call (one per case and repeat); retrieval runs on the in-memory fixture KB.
Chunk vectors come from the committed retrieval cache; rewritten-query vectors are cached in
FOLLOWUP_CACHE (gitignored path outside the committed file, so retrieval_runner's prune keeps it clean).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import statistics
import time
from datetime import datetime
from pathlib import Path
from typing import Any
from unittest.mock import patch

from app.agents import usage
from app.agents.retrieval import TOP_K, retrieve
from app.agents.rewrite import merge_results, rewrite_query
from app.config import Settings
from app.eval.corpus import EmbeddingCache, InMemoryKnowledgeBase
from app.eval.ir_metrics import mean, recall_at_k, reciprocal_rank
from app.eval.retrieval_runner import CACHE_PATH, IST
from app.models import AgentContext

EVAL_DIR = Path(__file__).parent
SET_PATH = EVAL_DIR / "followup_set.json"
FOLLOWUP_CACHE = EVAL_DIR / "fixtures" / "followup_embeddings.json"
REPORTS_DIR = EVAL_DIR / "reports" / "followup"
MODES = ("typed", "replace", "both")


def _ids(result) -> list[str]:
    return [c.id for c in result.chunks]


async def run_case(q: dict, kb: InMemoryKnowledgeBase, settings: Settings, rep: int) -> dict[str, Any]:
    ctx = AgentContext(conversation_id=f"fu-{q['id']}-r{rep}", conversation_history=q.get("history", []))
    with usage.track_turn() as turn:
        start = time.monotonic()
        rewritten = await rewrite_query(q["query"], ctx, settings)
        rewrite_ms = int((time.monotonic() - start) * 1000)
    typed = await retrieve(q["query"], kb, settings)
    replaced = typed if rewritten == q["query"] else await retrieve(rewritten, kb, settings)
    results = {"typed": typed, "replace": replaced, "both": merge_results(replaced, typed)}
    row: dict[str, Any] = {
        "id": q["id"], "kind": q["kind"], "repeat": rep, "query": q["query"], "rewritten": rewritten,
        "relevant": q["relevant"], "rewrite_ms": rewrite_ms, "rewrite_tokens": turn.total_tokens(),
        "rewrite_calls": len(turn.calls),
    }
    for mode, res in results.items():
        final = _ids(res)
        row[mode] = {
            "final": final,
            "abstained": res.should_abstain,
            "recall@5": recall_at_k(final, q["relevant"], TOP_K),
            "mrr@5": reciprocal_rank(final, q["relevant"], TOP_K),
            "context_recall": recall_at_k(final, q["relevant"], len(final)) if final else 0.0,
        }
    return row


def score(rows: list[dict]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for kind in ("followup", "typo_followup", "control", "all"):
        subset = [r for r in rows if kind == "all" or r["kind"] == kind]
        if not subset:
            continue
        out[kind] = {
            mode: {
                "recall@5": mean([r[mode]["recall@5"] for r in subset]),
                "mrr@5": mean([r[mode]["mrr@5"] for r in subset]),
                "context_recall": mean([r[mode]["context_recall"] for r in subset]),
                "false_abstention": mean([1.0 if r[mode]["abstained"] else 0.0 for r in subset]),
            }
            for mode in MODES
        }
    called = [r for r in rows if r["rewrite_calls"]]
    out["rewrite"] = {
        "p50_ms": statistics.median([r["rewrite_ms"] for r in called]) if called else None,
        "tokens_mean": mean([r["rewrite_tokens"] for r in called]) if called else None,
        # Controls stand alone: how often the rewrite changed them at all.
        "control_changed": mean([1.0 if r["rewritten"].strip().lower() != r["query"].strip().lower() else 0.0
                                 for r in rows if r["kind"] == "control"]),
    }
    return out


def aggregate(per_repeat: list[dict]) -> dict[str, Any]:
    """Mean ± std across repeats for every leaf metric."""
    def walk(nodes: list[Any]) -> Any:
        if isinstance(nodes[0], dict):
            return {k: walk([n[k] for n in nodes]) for k in nodes[0]}
        vals = [v for v in nodes if v is not None]
        if not vals:
            return None
        return {"mean": round(statistics.fmean(vals), 4), "std": round(statistics.pstdev(vals), 4)}
    return walk(per_repeat)


def print_table(agg: dict) -> None:
    print(f"{'set':14} {'mode':8} | {'R@5':>13} | {'MRR@5':>13} | {'false_abst':>13}")
    for kind in ("followup", "typo_followup", "control", "all"):
        if kind not in agg:
            continue
        for mode in MODES:
            m = agg[kind][mode]
            cell = lambda k: f"{m[k]['mean']:.3f} ± {m[k]['std']:.3f}"
            print(f"{kind:14} {mode:8} | {cell('recall@5'):>13} | {cell('mrr@5'):>13} | {cell('false_abstention'):>13}")
    rw = agg["rewrite"]
    print(f"rewrite call p50 {rw['p50_ms']['mean']:.0f} ± {rw['p50_ms']['std']:.0f} ms, "
          f"{rw['tokens_mean']['mean']:.0f} tokens; controls changed {rw['control_changed']['mean']:.2f}")


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    queries = json.loads(SET_PATH.read_text())["queries"]
    cache = EmbeddingCache(settings, path=CACHE_PATH, offline=True)
    kb = await InMemoryKnowledgeBase.load(cache)
    # Query vectors (typed and rewritten) go to their own file; the committed cache stays untouched.
    qcache = EmbeddingCache(settings, path=FOLLOWUP_CACHE)
    qcache.data = {**cache.data, **qcache.data}
    sem = asyncio.Semaphore(args.concurrency)

    async def bounded(q: dict, rep: int) -> dict:
        async with sem:
            return await run_case(q, kb, settings, rep)

    with patch("app.agents.retrieval.generate_embedding", lambda text, _s, _task: qcache.embed(text)):
        rows = await asyncio.gather(*(bounded(q, rep) for rep in range(args.repeat) for q in queries))
    qcache.data = {k: v for k, v in qcache.data.items() if k not in cache.data}
    qcache.save()

    per_repeat = [score([r for r in rows if r["repeat"] == rep]) for rep in range(args.repeat)]
    agg = aggregate(per_repeat)
    print_table(agg)
    changed = [r for r in rows if r["kind"] == "control" and r["rewritten"].strip().lower() != r["query"].strip().lower()]
    for r in changed[:8]:
        print(f"  control rewritten: {r['id']} {r['query']!r} -> {r['rewritten']!r}")
    for r in [r for r in rows if r["kind"] != "control" and r["replace"]["recall@5"] < 1][:12]:
        print(f"  miss (replace): {r['id']} r{r['repeat']} {r['rewritten']!r} -> {r['replace']['final'][:5]}")

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(IST)
    path = REPORTS_DIR / f"{now:%Y-%m-%d-%H%M}-{args.label}.json"
    path.write_text(json.dumps({"label": args.label, "llm_model": settings.llm_model, "repeat": args.repeat,
                                "aggregate": agg, "rows": rows}, indent=1, ensure_ascii=False))
    print(f"Report saved to {path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Follow-up retrieval: typed vs rewritten vs both")
    parser.add_argument("--label", default="run")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=4)
    logging.basicConfig(level=logging.WARNING)
    logging.getLogger("langfuse").setLevel(logging.ERROR)
    raise SystemExit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
