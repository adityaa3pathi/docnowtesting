"""Measures the verifier alone, in both directions, on hand-built drafts (app/eval/verifier_set.json).

- false_block_rate: a fully supported draft is blocked, or its supported text is stripped.
- false_pass_rate: a planted unsupported claim survives into the text the user would see.

Scoring looks at what the user gets, not the verdict label: UNGROUNDED shows the abstention message,
anything else shows `cleaned_response`. One Gemini call per case, so repeats are cheap.

Usage:
    python -m app.eval.verifier_runner --repeat 5 --label baseline
"""
from __future__ import annotations

import argparse
import asyncio
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

from app.agents.llm import AIBusyError
from app.agents.verifier import verify
from app.config import Settings
from app.eval.corpus import build_chunks
from app.eval.runner import IST, REPORTS_DIR
from app.eval.scorer import aggregate_runs
from app.models import RetrievalResult, RetrievedChunk
from app.prompts.verifier import ABSTENTION_MESSAGE

EVAL_DIR = Path(__file__).parent
SET_PATH = EVAL_DIR / "verifier_set.json"


def load_cases(path: Path = SET_PATH) -> list[dict[str, Any]]:
    cases = json.loads(path.read_text())["cases"]
    chunks = {c["id"]: c for c in build_chunks()}
    for case in cases:
        missing = [s for s in case["sources"] if s not in chunks]
        if missing:
            raise ValueError(f"{case['id']}: unknown source ids {missing}")
        case["chunks"] = [chunks[s] for s in case["sources"]]
    return cases


def score_case(case: dict[str, Any], verdict: str, shown: str) -> dict[str, Any]:
    """`shown` is the text the user would read after the verifier."""
    text = shown.lower()
    if case["expect"] == "supported":
        lost = [k for k in case.get("keep", []) if k.lower() not in text]
        return {"ok": verdict != "UNGROUNDED" and not lost, "lost": lost}
    leaked = [m for m in case["markers"] if m.lower() in text]
    return {"ok": not leaked, "leaked": leaked}


async def run_case(case: dict[str, Any], settings: Settings, repeat: int) -> dict[str, Any]:
    retrieval = RetrievalResult(
        chunks=[
            RetrievedChunk(id=c["id"], source=c["source"], title=c["title"], content=c["content"], similarity=0.8)
            for c in case["chunks"]
        ]
    )
    result = await verify(case["draft"], retrieval, [], settings)
    shown = ABSTENTION_MESSAGE if result.verdict == "UNGROUNDED" else result.cleaned_response
    return {
        "case_id": case["id"],
        "expect": case["expect"],
        "kind": case["kind"],
        "repeat": repeat,
        "verdict": result.verdict,
        "shown": shown,
        "reasoning": result.reasoning,
        **score_case(case, result.verdict, shown),
    }


def run_metrics(rows: list[dict[str, Any]]) -> dict[str, Any]:
    sup = [r for r in rows if r["expect"] == "supported"]
    uns = [r for r in rows if r["expect"] == "unsupported"]

    def rate(hits: int, n: int) -> float | None:
        return hits / n if n else None

    metrics = {
        "false_block_rate": rate(sum(not r["ok"] for r in sup), len(sup)),
        "false_pass_rate": rate(sum(not r["ok"] for r in uns), len(uns)),
        # Verdict labels alone: how often a draft with a planted claim was called fully GROUNDED.
        "unsupported_called_grounded": rate(sum(r["verdict"] == "GROUNDED" for r in uns), len(uns)),
        "supported_called_grounded": rate(sum(r["verdict"] == "GROUNDED" for r in sup), len(sup)),
    }
    for kind in sorted({r["kind"] for r in uns}):
        group = [r for r in uns if r["kind"] == kind]
        metrics[f"false_pass/{kind}"] = rate(sum(not r["ok"] for r in group), len(group))
    return metrics


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    cases = load_cases()
    if args.only:
        cases = [c for c in cases if c["id"] in args.only.split(",")]
    sem = asyncio.Semaphore(args.concurrency)

    async def bounded(case: dict[str, Any], rep: int) -> dict[str, Any]:
        async with sem:
            return await run_case(case, settings, rep)

    try:
        rows = await asyncio.gather(*(bounded(c, rep) for rep in range(args.repeat) for c in cases))
    except AIBusyError:
        print("Gemini quota hit; no valid result.")
        return 3

    runs = [run_metrics([r for r in rows if r["repeat"] == rep]) for rep in range(args.repeat)]
    aggregate = aggregate_runs(runs)
    print(f"\n{'Metric':<34} | {'Mean':>6} | {'Std':>6}")
    print("-" * 52)
    for metric, a in aggregate.items():
        print(f"{metric:<34} | {a['mean']:>6.3f} | {a['std']:>6.3f}")

    per_case: dict[str, dict[str, Any]] = {}
    for r in rows:
        row = per_case.setdefault(r["case_id"], {"expect": r["expect"], "kind": r["kind"], "ok": 0, "runs": 0, "verdicts": {}})
        row["runs"] += 1
        row["ok"] += r["ok"]
        row["verdicts"][r["verdict"]] = row["verdicts"].get(r["verdict"], 0) + 1
    print("\nCases that failed at least once:")
    for cid, row in per_case.items():
        if row["ok"] < row["runs"]:
            example = next(r for r in rows if r["case_id"] == cid and not r["ok"])
            what = example.get("leaked") or example.get("lost")
            print(f"  {cid} {row['kind']:<18} ok {row['ok']}/{row['runs']} {row['verdicts']} -> {what}")

    out = REPORTS_DIR / "verifier"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{datetime.now(IST):%Y-%m-%d-%H%M}-{args.label}.json"
    path.write_text(json.dumps(
        {"label": args.label, "llm_model": settings.llm_model, "repeat": args.repeat,
         "scores": {m: a["mean"] for m, a in aggregate.items()}, "aggregate": aggregate, "runs": runs,
         "per_case": per_case, "results": rows},
        indent=2, ensure_ascii=False,
    ))
    print(f"\nReport saved to {path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Verifier-only eval: false blocks and false passes")
    parser.add_argument("--label", default="run")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--only", default="", help="comma-separated case ids")
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
