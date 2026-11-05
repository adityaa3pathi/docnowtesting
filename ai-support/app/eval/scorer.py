"""Scores eval results: our own metrics plus RAGAS with a Gemini or Groq judge."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional

from app.agents.usage import STAGES

logger = logging.getLogger(__name__)

RAGAS_METRICS = ["faithfulness", "answer_relevancy", "context_precision", "context_recall"]
GROQ_PREFIX = "groq/"


@dataclass
class EvalResult:
    query_id: str
    category: str
    query: str
    response: str
    retrieved_contexts: list[str]
    retrieved_sources: list[str]
    ground_truth: Optional[str]
    should_abstain: bool
    was_abstained: bool
    verifier_verdict: Optional[str]
    expected_source: Optional[str]
    expected_tool: Optional[str]
    tools_called: list[str] = field(default_factory=list)
    latency_ms: int = 0
    error: Optional[str] = None
    usage: dict[str, Any] = field(default_factory=dict)


def _rate(hits: int, total: int) -> Optional[float]:
    return hits / total if total else None


def _percentile(values: list[int], pct: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * pct))]


def token_metrics(results: list[EvalResult]) -> dict[str, Any]:
    """Token cost per turn, cap hits, and p99 output+thinking per stage for setting caps."""
    with_usage = [r.usage for r in results if r.usage]
    totals = [u["total_tokens"] for u in with_usage]
    calls = [c for u in with_usage for c in u.get("per_call", [])]
    metrics: dict[str, Any] = {
        "tokens_per_turn_mean": round(sum(totals) / len(totals)) if totals else None,
        "tokens_per_turn_p95": _percentile(totals, 0.95),
        "cap_hit_rate": _rate(sum(u.get("cap_hits", 0) for u in with_usage), len(calls)),
    }
    for stage in STAGES:
        spent = [c["output_tokens"] + c["thought_tokens"] for c in calls if c["stage"] == stage]
        metrics[f"{stage}_output_p99"] = _percentile(spent, 0.99)
    return metrics


def custom_metrics(results: list[EvalResult]) -> dict[str, Any]:
    """Metrics that need no judge model."""
    answerable = [r for r in results if not r.should_abstain]
    with_source = [r for r in answerable if r.expected_source]
    with_tool = [r for r in results if r.expected_tool]
    latencies = sorted(r.latency_ms for r in results)
    checked = [r for r in results if r.verifier_verdict != "TOOL_ONLY"]

    return {
        "abstention_accuracy": _rate(sum(r.should_abstain == r.was_abstained for r in results), len(results)),
        "false_abstention_rate": _rate(sum(r.was_abstained for r in answerable), len(answerable)),
        "missed_abstention_rate": _rate(
            sum(not r.was_abstained for r in results if r.should_abstain),
            sum(r.should_abstain for r in results),
        ),
        # Tool-only answers carry no KB claims and skip the verifier, so they are not scored here.
        "groundedness_score": _rate(sum(r.verifier_verdict == "GROUNDED" for r in checked), len(checked)),
        "source_hit_rate": _rate(sum(r.expected_source in r.retrieved_sources for r in with_source), len(with_source)),
        "tool_choice_accuracy": _rate(sum(r.expected_tool in r.tools_called for r in with_tool), len(with_tool)),
        "error_rate": _rate(sum(r.error is not None for r in results), len(results)),
        "p50_latency_ms": latencies[len(latencies) // 2] if latencies else None,
        "p95_latency_ms": _percentile(latencies, 0.95),
        **token_metrics(results),
    }


def ragas_metrics(results: list[EvalResult], settings: Any, judge_model: str) -> dict[str, Optional[float]]:
    """RAGAS over answerable queries with a reference answer. Raises on failure, never fakes a 0."""
    from langchain_google_genai import GoogleGenerativeAIEmbeddings
    from ragas import EvaluationDataset, RunConfig, evaluate
    from ragas.embeddings import LangchainEmbeddingsWrapper
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import AnswerRelevancy, context_precision, context_recall, faithfulness

    rows = [
        {
            "user_input": r.query,
            "response": r.response,
            "retrieved_contexts": r.retrieved_contexts or [""],
            "reference": r.ground_truth,
        }
        for r in results
        if not r.should_abstain and r.ground_truth
    ]
    if not rows:
        return {m: None for m in RAGAS_METRICS}

    llm = LangchainLLMWrapper(_judge_chat_model(settings, judge_model))
    embeddings = LangchainEmbeddingsWrapper(
        GoogleGenerativeAIEmbeddings(
            model=f"models/{settings.embedding_model}", google_api_key=settings.gemini_api_key
        )
    )
    result = evaluate(
        EvaluationDataset.from_list(rows),
        # Groq rejects n>1 per request, so ask for one generated question per answer.
        metrics=[faithfulness, AnswerRelevancy(strictness=1), context_precision, context_recall],
        llm=llm,
        embeddings=embeddings,
        # Free tiers cap requests per minute; a few slow workers beat many timed-out ones.
        run_config=RunConfig(max_workers=2, timeout=180, max_retries=6, max_wait=60),
        show_progress=False,
    )
    frame = result.to_pandas()
    # A NaN means the judge failed on that row; report the mean of the rows it did score.
    return {m: float(frame[m].mean()) if m in frame and frame[m].notna().any() else None for m in RAGAS_METRICS}


def _judge_chat_model(settings: Any, judge_model: str) -> Any:
    """'groq/<model>' grades on Groq; anything else grades on Gemini."""
    if judge_model.startswith(GROQ_PREFIX):
        if not settings.groq_api_key:
            raise RuntimeError("judge is on Groq but SUPPORT_GROQ_API_KEY is not set")
        from langchain_groq import ChatGroq

        return ChatGroq(model=judge_model[len(GROQ_PREFIX):], temperature=0, api_key=settings.groq_api_key)

    from langchain_google_genai import ChatGoogleGenerativeAI

    return ChatGoogleGenerativeAI(model=judge_model, temperature=0, google_api_key=settings.gemini_api_key)
