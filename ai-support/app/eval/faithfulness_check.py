"""Cross-checks the verifier with RAGAS faithfulness on answers from a saved runner report.

Scores faithfulness only (claims in the answer supported by the retrieved contexts), on answers the
verifier actually checked: one repeat of every query, plus every non-GROUNDED answer and any --also ids.
Prints where the two disagree: verifier GROUNDED but faithfulness < 1 (possible false pass), or
verifier not GROUNDED but faithfulness 1 (possible false block). Read each one; RAGAS is a judge too.

Usage:
    python -m app.eval.faithfulness_check app/eval/reports/<report>.json --also edge-04
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.config import Settings
from app.eval.scorer import _judge_chat_model


def pick(results: list[dict], repeat: int, also: set[str]) -> list[dict]:
    return [
        r for r in results
        if r.get("verifier_ran")
        and (r["repeat"] == repeat or r["verifier_verdict"] != "GROUNDED" or r["query_id"] in also)
    ]


def faithfulness(rows: list[dict], settings: Settings, judge_model: str) -> list[float | None]:
    from ragas import EvaluationDataset, RunConfig, evaluate
    from ragas.llms import LangchainLLMWrapper
    from ragas.metrics import faithfulness as metric

    data = EvaluationDataset.from_list(
        [{"user_input": r["query"], "response": r["response"], "retrieved_contexts": r["retrieved_contexts"] or [""]}
         for r in rows]
    )
    result = evaluate(
        data,
        metrics=[metric],
        llm=LangchainLLMWrapper(_judge_chat_model(settings, judge_model)),
        run_config=RunConfig(max_workers=2, timeout=180, max_retries=6, max_wait=60),
        show_progress=False,
    )
    frame = result.to_pandas()
    return [None if v != v else float(v) for v in frame["faithfulness"]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("report")
    parser.add_argument("--repeat", type=int, default=0, help="which repeat to score in full")
    parser.add_argument("--also", default="", help="comma-separated query ids to score in every repeat")
    parser.add_argument("--judge-model", default=None)
    parser.add_argument("--out", default=None, help="json file for per-answer scores")
    args = parser.parse_args()

    settings = Settings()
    judge = args.judge_model or settings.llm_model
    report = json.loads(Path(args.report).read_text())
    rows = pick(report["results"], args.repeat, set(filter(None, args.also.split(","))))
    print(f"Scoring faithfulness on {len(rows)} answers (judge: {judge})...")
    scores = faithfulness(rows, settings, judge)

    out = []
    for r, f in zip(rows, scores):
        verdict = r["verifier_verdict"]
        flag = ""
        if f is not None and verdict == "GROUNDED" and f < 1:
            flag = "verifier passed, judge found unsupported claims"
        elif f is not None and verdict != "GROUNDED" and f == 1:
            flag = "verifier flagged, judge found all claims supported"
        out.append({"query_id": r["query_id"], "repeat": r["repeat"], "verdict": verdict, "faithfulness": f,
                    "flag": flag, "response": r["response"]})

    scored = [o for o in out if o["faithfulness"] is not None]
    grounded = [o["faithfulness"] for o in scored if o["verdict"] == "GROUNDED"]
    print(f"\nJudged {len(scored)}/{len(out)}. Mean faithfulness on verifier-GROUNDED answers: "
          f"{sum(grounded) / len(grounded):.3f} (n={len(grounded)})" if grounded else "")
    print(f"Faithfulness == 1: {sum(o['faithfulness'] == 1 for o in scored)}/{len(scored)}")
    for o in out:
        if o["flag"] or o["faithfulness"] is None:
            print(f"  {o['query_id']} r{o['repeat']} {o['verdict']} faith={o['faithfulness']}: {o['flag'] or 'judge failed'}")
            print(f"      {o['response'][:220]!r}")
    if args.out:
        Path(args.out).write_text(json.dumps(out, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
