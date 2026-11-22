"""SSE vs JSON over HTTP in the same window (Phase 5): time to first event and to the final answer.

Starts the real FastAPI app on localhost with real Gemini calls (knowledge base, embeddings and the
Express API faked exactly as in runner.py), optionally behind the real Express support proxy
(server/src/supportProxy.ts via ts-node), then sends every probe over both routes, interleaved, for
N rounds. The order inside each pair alternates, so neither route always goes second.

  python -m app.eval.stream_bench --corpus real --queries app/eval/fixtures/real/pipeline_probes.json \\
      --rounds 3 --via-proxy --out ~/docnow-eval-runs/p5-bench.jsonl

Cost: rounds x queries x 2 turns, ~3 Gemini calls each. Rows go to --out (keep it outside the repo:
real-catalog answers carry partner prices); --out doubles as a resume file.
Measured per turn: JSON total; SSE first byte, `start`, first `status` and `final`. Also probe_pass on
both routes' answers (the same checks as runner.py), so a transport bug that changed answers shows.
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import os
import socket
import statistics
import subprocess
import time
import types
from functools import partial
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

from app.config import Settings
from app.eval.corpus import REAL_DIR, EmbeddingCache, InMemoryKnowledgeBase, catalog_items
from app.eval.fake_express import FakeExpress
from app.eval.scorer import EvalResult, probe_passed

SECRET = "bench-proxy-secret"
SERVER_DIR = Path(__file__).resolve().parents[3] / "server"
# Express's chat limiter allows 10 turns a minute per caller; each bench request is its own caller.
PROXY_SCRIPT = """
import express from 'express';
import http from 'node:http';
import { mountSupportProxy, supportTarget } from './src/supportProxy';
const app = express();
app.use(express.json());
let n = 0;
app.use((req, _res, next) => { (req as any).userId = `bench-${n++}`; next(); });
mountSupportProxy(app, { target: supportTarget(process.env.AI_URL!), secret: process.env.SECRET! });
http.createServer(app).listen(Number(process.env.PORT), '127.0.0.1', () => console.log('READY'));
"""


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextlib.asynccontextmanager
async def ai_service(settings: Settings, kb: InMemoryKnowledgeBase):
    import uvicorn

    from app import main

    settings.proxy_secret = SECRET
    port = _free_port()
    with patch.object(main, "settings", settings), patch.object(main, "db", kb), \
            patch("app.routes.chat.get_current_user", new_callable=AsyncMock, return_value=None):
        server = uvicorn.Server(uvicorn.Config(main.app, host="127.0.0.1", port=port, lifespan="off",
                                               log_level="warning"))
        task = asyncio.create_task(server.serve())
        while not server.started:
            await asyncio.sleep(0.05)
        try:
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            await task


@contextlib.contextmanager
def express_proxy(ai_url: str):
    port = _free_port()
    env = {"PATH": os.environ["PATH"], "HOME": os.environ.get("HOME", ""), "AI_URL": ai_url, "SECRET": SECRET,
           "PORT": str(port)}
    proc = subprocess.Popen(["npx", "ts-node", "-T", "-e", PROXY_SCRIPT], cwd=SERVER_DIR, env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        for line in proc.stdout:  # wait for READY
            if "READY" in line:
                break
        else:
            raise RuntimeError("Express proxy did not start")
        yield f"http://127.0.0.1:{port}"
    finally:
        proc.terminate()
        proc.wait(timeout=10)


async def json_turn(client: httpx.AsyncClient, message: str) -> dict:
    t0 = time.monotonic()
    r = await client.post("/api/support/chat", json={"message": message})
    r.raise_for_status()
    return {"final_ms": int((time.monotonic() - t0) * 1000), "body": r.json()}


async def sse_turn(client: httpx.AsyncClient, message: str) -> dict:
    t0 = time.monotonic()
    ms = lambda: int((time.monotonic() - t0) * 1000)  # noqa: E731
    out: dict = {"stages": []}
    async with client.stream("POST", "/api/support/chat/stream", json={"message": message}) as r:
        r.raise_for_status()
        buffer = ""
        async for chunk in r.aiter_text():
            out.setdefault("first_byte_ms", ms())
            buffer += chunk
            while "\n\n" in buffer:
                block, buffer = buffer.split("\n\n", 1)
                fields = dict(ln.split(": ", 1) for ln in block.split("\n") if ln and not ln.startswith(":"))
                if not fields:
                    continue
                event, data = fields["event"], json.loads(fields["data"])
                if event == "start":
                    out["start_ms"] = ms()
                elif event == "status":
                    out.setdefault("first_status_ms", ms())
                    out["stages"].append(data["stage"])
                elif event in ("final", "error"):
                    out["final_ms"] = ms()
                    out["body"] = data if event == "final" else {"content": "", "error": data}
    return out


def _probe(q: dict, body: dict) -> bool | None:
    return probe_passed(EvalResult(
        query_id=q["id"], category=q["category"], query=q["query"], response=body.get("content", ""),
        retrieved_contexts=[], retrieved_sources=[], ground_truth=None, should_abstain=q["should_abstain"],
        was_abstained=body.get("was_abstained", False), verifier_verdict=None, expected_source=None,
        expected_tool=None, expect_any=q.get("expect_any", []), expect_none=q.get("expect_none", []),
        expect_all=q.get("expect_all", []),
    ))


def _pct(values: list[int], q: float) -> int | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(len(ordered) * q))]


def summarize(rows: list[dict]) -> dict:
    """Per round p50/p95 of each timing, then mean ± std across rounds."""
    timings = {
        "json final": ("json", "final_ms"),
        "sse first byte": ("sse", "first_byte_ms"),
        "sse start event": ("sse", "start_ms"),
        "sse first status": ("sse", "first_status_ms"),
        "sse final": ("sse", "final_ms"),
    }
    rounds = sorted({r["round"] for r in rows})
    out: dict = {}
    for name, (transport, key) in timings.items():
        per_round = {"p50": [], "p95": []}
        for rnd in rounds:
            vals = [r[key] for r in rows if r["round"] == rnd and r["transport"] == transport and key in r
                    and not r.get("error")]
            per_round["p50"].append(_pct(vals, 0.5))
            per_round["p95"].append(_pct(vals, 0.95))
        out[name] = {
            k: (round(statistics.mean(v)), round(statistics.pstdev(v)) if len(v) > 1 else 0)
            for k, v in per_round.items() if all(x is not None for x in v)
        }
    for transport in ("json", "sse"):
        passes = [r["probe_ok"] for r in rows if r["transport"] == transport and r.get("probe_ok") is not None]
        out[f"{transport} probe_pass"] = round(sum(passes) / len(passes), 3) if passes else None
        out[f"{transport} errors"] = sum(1 for r in rows if r["transport"] == transport and r.get("error"))
    return out


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--corpus", choices=["fixture", "real"], default="real")
    parser.add_argument("--queries", default=str(REAL_DIR / "pipeline_probes.json"))
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--via-proxy", action="store_true", help="put the real Express support proxy in front")
    parser.add_argument("--out", required=True, help="jsonl rows (also the resume file); keep it outside the repo")
    args = parser.parse_args()

    settings = Settings()
    if not settings.gemini_api_key:
        print("SUPPORT_GEMINI_API_KEY is not set.")
        return 2
    real = args.corpus == "real"
    cache = EmbeddingCache(settings, path=REAL_DIR / "embeddings.json") if real else EmbeddingCache(settings)
    kb = await InMemoryKnowledgeBase.load(cache, args.corpus)
    queries = json.loads(Path(args.queries).read_text())["queries"]
    out = Path(args.out).expanduser()
    rows = [json.loads(ln) for ln in out.read_text().splitlines()] if out.exists() else []
    done = {(r["round"], r["query_id"], r["transport"]) for r in rows if not r.get("error")}
    rows = [r for r in rows if not r.get("error")]
    todo = sum((rnd, q["id"], t) not in done for rnd in range(args.rounds) for q in queries for t in ("json", "sse"))
    print(f"{len(queries)} queries x {args.rounds} rounds x 2 routes: {todo} turns to run (~{todo * 3} Gemini calls).")

    fake_httpx = types.SimpleNamespace(
        AsyncClient=partial(httpx.AsyncClient, transport=httpx.MockTransport(FakeExpress(catalog_items(args.corpus)))),
        HTTPStatusError=httpx.HTTPStatusError,
    )
    with patch("app.agents.action.httpx", fake_httpx), \
            patch("app.agents.retrieval.generate_embedding", lambda text, _s, _task: cache.embed(text)):
        async with ai_service(settings, kb) as ai_url:
            with (express_proxy(ai_url) if args.via_proxy else contextlib.nullcontext(ai_url)) as base:
                headers = {} if args.via_proxy else {"x-docnow-support-proxy": SECRET}
                async with httpx.AsyncClient(base_url=base, headers=headers, timeout=90) as client:
                    for rnd in range(args.rounds):
                        for i, q in enumerate(queries):
                            order = ("json", "sse") if (i + rnd) % 2 == 0 else ("sse", "json")
                            for transport in order:
                                if (rnd, q["id"], transport) in done:
                                    continue
                                row = {"round": rnd, "query_id": q["id"], "transport": transport,
                                       "via_proxy": args.via_proxy}
                                try:
                                    got = await (json_turn if transport == "json" else sse_turn)(client, q["query"])
                                    body = got.pop("body")
                                    row.update(got, probe_ok=_probe(q, body), content=body.get("content", ""),
                                               error=body.get("error"))
                                except Exception as exc:
                                    row["error"] = repr(exc)
                                rows.append(row)
                                with out.open("a") as f:
                                    f.write(json.dumps(row) + "\n")
                        print(f"round {rnd + 1}/{args.rounds} done")

    summary = summarize(rows)
    print(f"\n{'timing (ms)':18s} | {'p50 mean ± std':>16s} | {'p95 mean ± std':>16s}")
    for name, stats in summary.items():
        if isinstance(stats, dict) and stats:
            p50, p95 = stats.get("p50", ("-", "-")), stats.get("p95", ("-", "-"))
            print(f"{name:18s} | {p50[0]:>8} ± {p50[1]:<5} | {p95[0]:>8} ± {p95[1]:<5}")
    for key in ("json probe_pass", "sse probe_pass", "json errors", "sse errors"):
        print(f"{key}: {summary[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
