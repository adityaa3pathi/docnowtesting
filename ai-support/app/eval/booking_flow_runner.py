"""Multi-turn eval for cancel/reschedule without a booking ID (book-02/03/10/14).

A scripted customer answers each bot turn: "yes" to a confirm prompt, "the lipid profile one" when
asked which booking. Express is the fake (3 bookings: 12345 tomorrow, 98765 Saturday Lipid Profile,
55501 cancelled). Per conversation it records every tool call, so it can score:

- confirm_without_id: a "Reply YES" prompt whose pending write has no booking_id (the Phase 1 bug)
- write_without_id: a write tool executed without booking_id (always fails at the action agent)
- write_sent: the write reached Express; write_right_booking: it went to 98765, the one the customer named
- completed: the write succeeded (reschedule also needs a slot, which no flow collects yet)
- failed_after_yes: the customer said yes and got "I couldn't complete that"
- handed_to_app: the bot sent them to My Bookings > Reschedule instead of asking for a yes it can't honour

  python -m app.eval.booking_flow_runner --repeat 5 --label X
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import contextvars
import json
import sys
import time
import types
from datetime import datetime
from functools import partial
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx

from app.agents import action as action_agent
from app.agents.orchestrator import ACTION_FAILED_RESPONSE, BUSY_RESPONSE, handle_message
from app.config import Settings
from app.eval.corpus import EmbeddingCache, InMemoryKnowledgeBase, catalog_items
from app.eval.fake_express import FakeExpress
from app.eval.runner import IST, REPORTS_DIR
from app.eval.scorer import aggregate_runs
from app.models import AgentContext

GOLDEN = Path(__file__).parent / "golden_set.json"
SCENARIOS = ("book-02", "book-03", "book-10", "book-14")
TARGET = "98765"
CHOICE_REPLY = "the lipid profile one"
MAX_TURNS = 4
WRITES = ("cancel_booking", "reschedule_booking")

_calls: contextvars.ContextVar[list | None] = contextvars.ContextVar("calls", default=None)
_REAL_EXECUTE = action_agent.execute_action


async def _recording_execute(intent, ctx, settings):
    result = await _REAL_EXECUTE(intent, ctx, settings)
    if (calls := _calls.get()) is not None:
        calls.append({"tool": intent.tool_name, "params": dict(intent.parameters),
                      "success": result.success, "error": result.error})
    return result


def _is_confirm(content: str) -> bool:
    return "Reply YES" in content


async def run_conversation(q: dict, kb: Any, settings: Settings, repeat: int) -> dict:
    ctx = AgentContext(user_id="eval-user", is_authenticated=True, access_token="eval-token",
                       conversation_id=f"flow-{q['id']}-r{repeat}")
    calls: list[dict] = []
    _calls.set(calls)
    turns, message, start = [], q["query"], time.monotonic()
    tokens = 0
    for _ in range(MAX_TURNS):
        resp = await handle_message(message, ctx, kb, settings)
        if resp.content == BUSY_RESPONSE:
            return {"query_id": q["id"], "repeat": repeat, "busy": True}
        tokens += resp.token_count
        pending = resp.pending_action
        turns.append({"user": message, "bot": resp.content, "verdict": resp.verifier_verdict,
                      "pending": pending.model_dump() if pending else None})
        # Mirror the chat route: history grows, and the pending write lives only on the last bot message.
        ctx.conversation_history += [{"role": "user", "content": message}, {"role": "assistant", "content": resp.content}]
        ctx.pending_action = pending
        if _is_confirm(resp.content):
            message = "yes"
        elif pending:
            message = CHOICE_REPLY
        else:
            break
    writes = [c for c in calls if c["tool"] in WRITES]
    return {
        "query_id": q["id"], "repeat": repeat, "busy": False, "turns": turns, "tool_calls": calls,
        "n_turns": len(turns), "tokens": tokens, "latency_ms": int((time.monotonic() - start) * 1000),
        "confirm_without_id": any(_is_confirm(t["bot"]) and not (t["pending"] or {}).get("parameters", {}).get("booking_id")
                                  for t in turns),
        "asked_which": any(t["pending"] and not _is_confirm(t["bot"]) for t in turns),
        "write_without_id": any(not c["params"].get("booking_id") for c in writes),
        "write_sent": any(c["params"].get("booking_id") for c in writes),
        "write_right_booking": any(c["params"].get("booking_id") == TARGET for c in writes),
        "completed": any(c["success"] for c in writes),
        "failed_after_yes": any(t["user"] == "yes" and t["bot"] == ACTION_FAILED_RESPONSE for t in turns),
        "handed_to_app": "My Bookings" in turns[-1]["bot"] and not writes,
        "write_errors": [c["error"] for c in writes if not c["success"]],
    }


def run_metrics(rows: list[dict]) -> dict:
    def rate(key: str, subset: list[dict] = rows) -> float | None:
        return sum(bool(r[key]) for r in subset) / len(subset) if subset else None

    cancels = [r for r in rows if r["query_id"] == "book-02"]
    metrics = {k: rate(k) for k in ("confirm_without_id", "write_without_id", "asked_which", "write_sent",
                                     "write_right_booking", "completed", "failed_after_yes", "handed_to_app")}
    metrics["cancel_completed"] = rate("completed", cancels)
    metrics["turns_per_conversation"] = sum(r["n_turns"] for r in rows) / len(rows)
    metrics["tokens_per_conversation"] = sum(r["tokens"] for r in rows) / len(rows)
    return metrics


async def run(args: argparse.Namespace) -> int:
    settings = Settings()
    queries = [q for q in json.loads(GOLDEN.read_text())["queries"] if q["id"] in SCENARIOS]
    cache = EmbeddingCache(settings)
    kb = await InMemoryKnowledgeBase.load(cache, "fixture")
    fake_httpx = types.SimpleNamespace(
        AsyncClient=partial(httpx.AsyncClient, transport=httpx.MockTransport(FakeExpress(catalog_items("fixture")))),
        HTTPStatusError=httpx.HTTPStatusError,
    )
    sem = asyncio.Semaphore(args.concurrency)

    async def bounded(q: dict, rep: int) -> dict:
        async with sem:
            return await run_conversation(q, kb, settings, rep)

    with contextlib.ExitStack() as stack:
        stack.enter_context(patch("app.agents.action.httpx", fake_httpx))
        stack.enter_context(patch("app.agents.action.execute_action", _recording_execute))
        stack.enter_context(patch("app.agents.retrieval.generate_embedding", lambda text, _s, _t: cache.embed(text)))
        rows = await asyncio.gather(*(bounded(q, rep) for rep in range(args.repeat) for q in queries))

    if any(r["busy"] for r in rows):
        print("Gemini quota hit; no valid result.")
        return 3
    runs = [run_metrics([r for r in rows if r["repeat"] == rep]) for rep in range(args.repeat)]
    aggregate = aggregate_runs(runs)
    print(f"\n{'Metric':<26} | {'Mean':>7} | {'Std':>6}")
    print("-" * 45)
    for metric, a in aggregate.items():
        print(f"{metric:<26} | {a['mean']:>7.3f} | {a['std']:>6.3f}")
    print()
    for r in rows:
        if r["repeat"] == 0:
            print(f"--- {r['query_id']}: completed={r['completed']} errors={r['write_errors']}")
            for t in r["turns"]:
                print(f"  U: {t['user']}\n  B: {t['bot'][:220]!r}")

    out = REPORTS_DIR / "booking_flow"
    out.mkdir(parents=True, exist_ok=True)
    path = out / f"{datetime.now(IST):%Y-%m-%d-%H%M}-{args.label}.json"
    path.write_text(json.dumps({"label": args.label, "llm_model": settings.llm_model, "repeat": args.repeat,
                                "scores": {m: a["mean"] for m, a in aggregate.items()}, "aggregate": aggregate,
                                "runs": runs, "results": rows}, indent=2, ensure_ascii=False))
    print(f"\nReport saved to {path}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-turn cancel/reschedule flow without a booking ID")
    parser.add_argument("--label", default="run")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--concurrency", type=int, default=4)
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
