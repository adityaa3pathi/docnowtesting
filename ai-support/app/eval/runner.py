"""Runs the real support pipeline on the golden set and scores it.

Usage:
    python -m app.eval.runner --label baseline            # full run + RAGAS
    python -m app.eval.runner --no-ragas --limit 10       # quick, no judge cost
    python -m app.eval.runner --judge-model groq/openai/gpt-oss-120b  # grade on Groq
    python -m app.eval.runner --no-ragas --repeat 5 --resume r5.jsonl  # mean ± std over 5 passes
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import contextvars
import json
import logging
import os
import sys
import time
import types
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
from functools import partial
from pathlib import Path
from unittest.mock import patch

import httpx

from app import genai_client
from app.agents import orchestrator
from app.agents.orchestrator import BUSY_RESPONSE, handle_message
from app.config import Settings
from app.eval.corpus import REAL_DIR, EmbeddingCache, InMemoryKnowledgeBase, catalog_items
from app.eval.fake_express import FakeExpress
from app.eval.omission import OmissionChecker
from app.eval.rerank_cache import PATHS as RERANK_PATHS
from app.eval.rerank_cache import RerankCache
from app.eval.scorer import (
    EvalResult,
    aggregate_runs,
    custom_metrics,
    probe_passed,
    query_stability,
    ragas_metrics,
)
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


# What the pipeline decided inside one query: intent, draft, verifier verdict and reasoning.
_current_trace: contextvars.ContextVar[dict | None] = contextvars.ContextVar("trace", default=None)


async def _traced_verify(draft, retrieval, actions, settings):
    result = await _REAL_VERIFY(draft, retrieval, actions, settings)
    if (trace := _current_trace.get()) is not None:
        trace.update(verifier_ran=True, draft=draft, verifier_reasoning=result.reasoning)
    return result


async def _traced_classify(*args, **kwargs):
    intent = await _REAL_CLASSIFY(*args, **kwargs)
    if (trace := _current_trace.get()) is not None:
        trace["intent"] = f"{intent.intent}/{intent.tool_name or '-'}"
    return intent


_REAL_VERIFY = orchestrator.verify
_REAL_CLASSIFY = orchestrator.classify_intent


class _ErrorCollector(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        errors = _current_errors.get()
        if errors is not None and record.levelno >= logging.ERROR:
            errors.append(f"{record.getMessage()}: {record.exc_info[1]!r}" if record.exc_info else record.getMessage())


async def run_query(
    q: dict, kb: InMemoryKnowledgeBase, settings: Settings, omissions: OmissionChecker, repeat: int = 0
) -> EvalResult:
    ctx = AgentContext(
        user_id="eval-user",
        is_authenticated=True,
        access_token="eval-token",
        conversation_id=f"eval-{q['id']}-r{repeat}",
    )
    start = time.monotonic()
    error = None
    logged: list[str] = []
    _current_errors.set(logged)
    trace: dict = {}
    _current_trace.set(trace)
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
        acceptable_tools=q.get("acceptable_tools", []),
        # A write tool waiting for the user's "yes" still counts as the right choice.
        tools_called=[a.tool for a in resp.actions_taken]
        + ([resp.pending_action.tool_name] if resp.pending_action else [])
        if resp
        else [],
        latency_ms=int((time.monotonic() - start) * 1000),
        error=error,
        usage=resp.usage if resp else {},
        expect_any=q.get("expect_any", []),
        expect_none=q.get("expect_none", []),
        expect_all=q.get("expect_all", []),
        omissions=[f"{o.item}: {o.test}" for o in omissions.check(q["query"], resp.content)] if resp else [],
        repeat=repeat,
        intent=trace.get("intent"),
        verifier_ran=trace.get("verifier_ran", False),
        draft=trace.get("draft"),
        verifier_reasoning=trace.get("verifier_reasoning"),
    )


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    if not settings.gemini_api_key and not args.groq_model:
        print("SUPPORT_GEMINI_API_KEY is not set. The eval calls the real pipeline and needs it.")
        return 2

    queries = json.loads(Path(args.queries).read_text())["queries"]
    if args.category:
        queries = [q for q in queries if q["category"] == args.category]
    queries = queries[: args.limit] if args.limit else queries
    if args.per_category:
        picked, seen = [], {}
        for q in queries:
            seen[q["category"]] = seen.get(q["category"], 0) + 1
            if seen[q["category"]] <= args.per_category:
                picked.append(q)
        queries = picked

    logging.getLogger("app").addHandler(_ErrorCollector())
    init_langfuse(settings)
    real = args.corpus == "real"
    cache = EmbeddingCache(settings, path=REAL_DIR / "embeddings.json") if real else EmbeddingCache(settings)
    kb = await InMemoryKnowledgeBase.load(cache, args.corpus)
    omissions = OmissionChecker(catalog_items(args.corpus))
    if args.no_keyword:
        kb.keyword_search = partial(_no_hits)
    rerank_cache = None
    if args.rerank:
        if not settings.cohere_api_key:
            print("--rerank needs SUPPORT_COHERE_API_KEY.")
            return 2
        settings.rerank_enabled = True
        settings.rerank_min_score = args.rerank_min_score
        rerank_cache = RerankCache(settings, RERANK_PATHS[args.corpus], rpm=args.rerank_rpm)
    # --resume keeps finished answers on disk so a run can stop when keys run out and continue later.
    resume = Path(args.resume) if args.resume else None
    done: dict[tuple[int, str], EvalResult] = {}
    if resume and resume.exists():
        for line in resume.read_text().splitlines():
            row = json.loads(line)
            done[(row.get("repeat", 0), row["query_id"])] = EvalResult(**row)
    jobs = [(rep, q) for rep in range(args.repeat) for q in queries]
    todo = sum((rep, q["id"]) not in done for rep, q in jobs)
    print(f"Knowledge base: {len(kb.chunks)} chunks. {len(jobs) - todo} done, running {todo} answers "
          f"({len(queries)} queries x {args.repeat} runs)...")
    out_of_keys = False

    # Free-tier keys allow a few calls a minute; a query makes at most 3, so pace whole queries.
    pause = 3 * 60 / args.rpm if args.rpm else 0
    sem = asyncio.Semaphore(1 if pause else args.concurrency)

    # Extra free-tier keys (comma list, eval only): on a quota reply, switch key and rerun the query.
    spare_keys = [k.strip() for k in os.environ.get("SUPPORT_GEMINI_API_KEYS", "").split(",") if k.strip()]

    async def bounded(rep: int, q: dict) -> EvalResult | None:
        nonlocal out_of_keys
        if (rep, q["id"]) in done:
            return done[(rep, q["id"])]
        async with sem:
            if out_of_keys:
                return None
            result = await run_query(q, kb, settings, omissions, rep)
            while result.response == BUSY_RESPONSE and spare_keys:
                print(f"Quota hit on {q['id']}; switching to the next key ({len(spare_keys) - 1} left after this).")
                settings.gemini_api_key = spare_keys.pop(0)
                genai_client._client = None
                result = await run_query(q, kb, settings, omissions, rep)
            if result.response == BUSY_RESPONSE:
                out_of_keys = True
                return None
            if resume:
                with resume.open("a") as f:
                    f.write(json.dumps(asdict(result)) + "\n")
            await asyncio.sleep(pause)
            return result

    # Swap only the HTTP client the action agent uses; Gemini's own httpx stays real.
    fake_httpx = types.SimpleNamespace(
        AsyncClient=partial(httpx.AsyncClient, transport=httpx.MockTransport(FakeExpress(catalog_items(args.corpus)))),
        HTTPStatusError=httpx.HTTPStatusError,
    )
    # Query embeddings go through the same disk cache, so reruns only pay for LLM calls.
    patches = [
        patch("app.agents.orchestrator.verify", _traced_verify),
        patch("app.agents.orchestrator.classify_intent", _traced_classify),
        patch("app.agents.action.httpx", fake_httpx),
        patch("app.agents.retrieval.generate_embedding", lambda text, _s, _task: cache.embed(text)),
    ]
    if rerank_cache:
        patches.append(patch("app.agents.rerank.score_documents", rerank_cache.score))
    if args.groq_model:
        # Same pipeline, open model on Groq: compares old vs new code without Gemini quota.
        from app.eval.groq_llm import make_groq_call

        groq_call = make_groq_call(args.groq_model)
        patches += [patch(f"app.agents.{m}.call_gemini", groq_call) for m in ("orchestrator", "verifier")]
    with contextlib.ExitStack() as stack:
        for p in patches:
            stack.enter_context(p)
        results = await asyncio.gather(*(bounded(rep, q) for rep, q in jobs))

    if out_of_keys:
        finished = sum(r is not None for r in results)
        print(f"ALL_KEYS_EXHAUSTED: {finished}/{len(jobs)} answers done. Add a key and rerun with the same --resume.")
        return 3

    if rerank_cache and rerank_cache.failures:
        print(f"RERANK_FAILED on {len(rerank_cache.failures)} queries; these answers used RRF order, not a valid run.")
        return 2

    judge_model = args.judge_model or settings.llm_model
    runs: list[dict] = []
    for rep in range(args.repeat):
        run_results = [r for r in results if r.repeat == rep]
        run_scores: dict = custom_metrics(run_results)
        if not args.no_ragas:
            print(f"Scoring run {rep + 1}/{args.repeat} with RAGAS (judge: {judge_model})...")
            run_scores.update(ragas_metrics(run_results, settings, judge_model))
        runs.append(run_scores)
    scores = runs[0]
    aggregate = stability = None
    if args.repeat > 1:
        aggregate = aggregate_runs(runs)
        scores = {m: a["mean"] for m, a in aggregate.items()}  # the gate and the report use the mean
        stability = query_stability(results)
        print_aggregate(aggregate)
        flaky = {qid: row for qid, row in stability.items() if row["flaky"]}
        print(f"\nFlaky queries: {len(flaky)}/{len(stability)}")
        for qid, row in flaky.items():
            shown = {k: row[k] for k in row["flaky"]}
            print(f"  {qid}: {shown} intents={row['intents']}")
    else:
        print_table(scores)
    for r in results:
        if probe_passed(r) is False:
            print(f"probe FAILED {r.query_id}: {r.response[:160]!r}")
        for o in r.omissions:
            print(f"OMISSION {r.query_id}: says not included, catalog lists it -> {o}")
    report_path = save_report(args, settings, judge_model, scores, results, runs, aggregate, stability)
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
        shown = "n/a" if value is None else (f"{value:.0f}" if isinstance(value, int) else f"{value:.3f}")
        threshold = THRESHOLDS.get(metric)
        print(f"{metric:<24} | {shown:>8} | {threshold if threshold is not None else '':>9}")


def print_aggregate(aggregate: dict) -> None:
    print(f"\n{'Metric':<24} | {'Mean':>8} | {'Std':>7} | {'Min':>8} | {'Max':>8} | {'n':>2}")
    print("-" * 70)
    for metric, a in aggregate.items():
        if a["mean"] is None:
            print(f"{metric:<24} | {'n/a':>8} |")
            continue
        fmt = (lambda v: f"{v:.0f}") if a["mean"] > 10 else (lambda v: f"{v:.3f}")
        print(f"{metric:<24} | {fmt(a['mean']):>8} | {fmt(a['std']):>7} | {fmt(a['min']):>8} | {fmt(a['max']):>8} | {a['n']:>2}")


def save_report(
    args: argparse.Namespace,
    settings: Settings,
    judge_model: str,
    scores: dict,
    results: list,
    runs: list[dict] | None = None,
    aggregate: dict | None = None,
    stability: dict | None = None,
) -> Path:
    now = datetime.now(IST)
    # Real-corpus reports quote partner prices, so they stay in the gitignored snapshot folder.
    reports = REAL_DIR / "reports" if args.corpus == "real" else REPORTS_DIR
    reports.mkdir(parents=True, exist_ok=True)
    path = reports / f"{now:%Y-%m-%d-%H%M}-{args.label}.json"
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
                "rerank": settings.rerank_model if settings.rerank_enabled else None,
                "rerank_min_score": settings.rerank_min_score if settings.rerank_enabled else None,
                "corpus": args.corpus,
                "repeat": args.repeat,
                # With --repeat, "scores" is the mean per metric; "aggregate" adds std/min/max and "runs" each pass.
                "scores": scores,
                "aggregate": aggregate,
                "runs": runs if aggregate else None,
                "per_query": stability,
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
    parser.add_argument("--groq-model", default=None, help="run the pipeline on this Groq model instead of Gemini")
    parser.add_argument("--resume", default=None, help="jsonl file of finished answers to continue from")
    parser.add_argument("--per-category", type=int, default=0, help="first N questions of each category")
    parser.add_argument("--rpm", type=int, default=0, help="Gemini calls per minute allowed by the key")
    parser.add_argument("--corpus", choices=["fixture", "real"], default="fixture",
                        help="real = local production catalog snapshot (gitignored)")
    parser.add_argument("--queries", default=str(EVAL_DIR / "golden_set.json"), help="query set to run")
    parser.add_argument("--repeat", type=int, default=1, help="run the query set N times; report mean ± std")
    parser.add_argument("--no-ragas", action="store_true")
    parser.add_argument("--no-keyword", action="store_true", help="dense-only baseline (BM25 off)")
    parser.add_argument("--gate", action="store_true", help="exit 1 if a metric is below threshold")
    parser.add_argument("--rerank", action="store_true", help="rerank with Cohere (scores cached on disk)")
    parser.add_argument("--rerank-min-score", type=float, default=0.0, help="reranker gate; 0 = off")
    parser.add_argument("--rerank-rpm", type=int, default=0, help="pace Cohere calls (trial key: 10)")
    logging.basicConfig(level=logging.WARNING)
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
