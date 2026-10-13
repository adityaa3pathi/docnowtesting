"""Runs the real support pipeline on the golden set and scores it.

Usage:
    python -m app.eval.runner --label baseline            # full run + RAGAS
    python -m app.eval.runner --no-ragas --limit 10       # quick, no judge cost
    python -m app.eval.runner --judge-model groq/openai/gpt-oss-120b  # grade on Groq
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import json
import logging
import sys
import time
import types
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from functools import partial
from pathlib import Path
from unittest.mock import patch

import httpx

from app.agents.orchestrator import handle_message
from app.config import Settings
from app.eval.corpus import EmbeddingCache, InMemoryKnowledgeBase
from app.eval.fake_express import FakeExpress
from app.eval.scorer import EvalResult, custom_metrics, ragas_metrics
from app.models import AgentContext
from app.observability import init_langfuse, shutdown_langfuse

logger = logging.getLogger(__name__)

EVAL_DIR = Path(__file__).parent
REPORTS_DIR = EVAL_DIR / "reports"
IST = timezone(timedelta(hours=5, minutes=30))

# Gate only on metrics that exist today; Phase 3 tightens these.
THRESHOLDS = {
    "faithfulness": 0.85,
    "answer_relevancy": 0.75,
    "context_precision": 0.70,
    "context_recall": 0.70,
    "abstention_accuracy": 0.90,
    "source_hit_rate": 0.85,
    "tool_choice_accuracy": 0.80,
}


# The pipeline logs and swallows Gemini failures; this ties each logged error to its query.
_current_errors: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar("errors", default=None)


class _ErrorCollector(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        errors = _current_errors.get()
        if errors is not None and record.levelno >= logging.ERROR:
            errors.append(f"{record.getMessage()}: {record.exc_info[1]!r}" if record.exc_info else record.getMessage())


async def run_query(q: dict, kb: InMemoryKnowledgeBase, settings: Settings) -> EvalResult:
    ctx = AgentContext(
        user_id="eval-user",
        is_authenticated=True,
        access_token="eval-token",
        conversation_id=f"eval-{q['id']}",
    )
    start = time.monotonic()
    error = None
    logged: list[str] = []
    _current_errors.set(logged)
    try:
        resp = await handle_message(q["query"], ctx, kb, settings)
    except Exception as exc:  # handle_message already catches; this is belt and braces
        error, resp = repr(exc), None
    error = error or ("; ".join(logged) if logged else None)

    return EvalResult(
        query_id=q["id"],
        category=q["category"],
        query=q["query"],
        response=resp.content if resp else "",
        retrieved_contexts=[c.content for c in resp.sources] if resp else [],
        retrieved_sources=[c.source for c in resp.sources] if resp else [],
        ground_truth=q.get("ground_truth"),
        should_abstain=q["should_abstain"],
        was_abstained=resp.was_abstained if resp else True,
        verifier_verdict=resp.verifier_verdict if resp else None,
        expected_source=q.get("expected_source"),
        expected_tool=q.get("expected_tool"),
        tools_called=[a.tool for a in resp.actions_taken] if resp else [],
        latency_ms=int((time.monotonic() - start) * 1000),
        error=error,
    )


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    if not settings.gemini_api_key:
        print("SUPPORT_GEMINI_API_KEY is not set. The eval calls the real pipeline and needs it.")
        return 2

    queries = json.loads((EVAL_DIR / "golden_set.json").read_text())["queries"]
    if args.category:
        queries = [q for q in queries if q["category"] == args.category]
    queries = queries[: args.limit] if args.limit else queries

    logging.getLogger("app").addHandler(_ErrorCollector())
    init_langfuse(settings)
    cache = EmbeddingCache(settings)
    kb = await InMemoryKnowledgeBase.load(cache)
    if args.no_keyword:
        kb.keyword_search = partial(_no_hits)
    print(f"Knowledge base: {len(kb.chunks)} chunks. Running {len(queries)} queries...")

    sem = asyncio.Semaphore(args.concurrency)

    async def bounded(q: dict) -> EvalResult:
        async with sem:
            return await run_query(q, kb, settings)

    # Swap only the HTTP client the action agent uses; Gemini's own httpx stays real.
    fake_httpx = types.SimpleNamespace(
        AsyncClient=partial(httpx.AsyncClient, transport=httpx.MockTransport(FakeExpress())),
        HTTPStatusError=httpx.HTTPStatusError,
    )
    # Query embeddings go through the same disk cache, so reruns only pay for LLM calls.
    with (
        patch("app.agents.action.httpx", fake_httpx),
        patch("app.agents.retrieval.generate_embedding", lambda text, _s: cache.embed(text)),
    ):
        results = await asyncio.gather(*(bounded(q) for q in queries))

    scores: dict = custom_metrics(results)
    judge_model = args.judge_model or settings.llm_model
    if not args.no_ragas:
        print(f"Scoring with RAGAS (judge: {judge_model})...")
        scores.update(ragas_metrics(results, settings, judge_model))

    print_table(scores)
    report_path = save_report(args, settings, judge_model, scores, results)
    print(f"Report saved to {report_path}")
    shutdown_langfuse()

    errored = sum(r.error is not None for r in results)
    if errored:
        print(f"\n{errored}/{len(results)} queries hit errors (see report); these scores are not a valid result.")
        return 1
    failed = [m for m, t in THRESHOLDS.items() if scores.get(m) is not None and scores[m] < t]
    if failed:
        print(f"\nBelow threshold: {', '.join(failed)}")
    return 1 if (failed and args.gate) else 0


async def _no_hits(query: str, limit: int = 20) -> list:
    """Dense-only baseline: BM25 contributes nothing to the fusion."""
    return []


def print_table(scores: dict) -> None:
    print(f"\n{'Metric':<24} | {'Score':>8} | {'Threshold':>9}")
    print("-" * 47)
    for metric, value in scores.items():
        shown = "n/a" if value is None else (f"{value:.0f}" if "latency" in metric else f"{value:.3f}")
        threshold = THRESHOLDS.get(metric)
        print(f"{metric:<24} | {shown:>8} | {threshold if threshold is not None else '':>9}")


def save_report(args: argparse.Namespace, settings: Settings, judge_model: str, scores: dict, results: list) -> Path:
    now = datetime.now(IST)
    REPORTS_DIR.mkdir(exist_ok=True)
    path = REPORTS_DIR / f"{now:%Y-%m-%d-%H%M}-{args.label}.json"
    path.write_text(
        json.dumps(
            {
                "label": args.label,
                "run_at_ist": now.strftime("%d-%m-%Y %H:%M IST"),
                "llm_model": settings.llm_model,
                "embedding_model": settings.embedding_model,
                "judge_model": judge_model,
                "relevance_threshold": settings.relevance_threshold,
                "keyword_search": not args.no_keyword,
                "scores": scores,
                "results": [asdict(r) for r in results],
            },
            indent=2,
            ensure_ascii=False,
        )
    )
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the golden-set eval on the real pipeline")
    parser.add_argument("--label", default="run")
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--category", choices=["catalog", "booking", "policy", "edge"])
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--judge-model", default=None)
    parser.add_argument("--no-ragas", action="store_true")
    parser.add_argument("--no-keyword", action="store_true", help="dense-only baseline (BM25 off)")
    parser.add_argument("--gate", action="store_true", help="exit 1 if a metric is below threshold")
    logging.basicConfig(level=logging.WARNING)
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
