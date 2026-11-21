"""Builds the retrieval set for the real (production snapshot) corpus. Output stays gitignored.

    python -m app.eval.build_real_set            # coverage report + writes fixtures/real/retrieval_set.json
    python -m app.eval.build_real_set --coverage # only the indexing-coverage report, no LLM calls

Query sources:
  constituent_cut / constituent_kept  built from the data, no LLM: "which package includes X?", labelled with
      every item that lists X. "cut" means X sits past the 15-item cut in format_catalog_text() in every
      item that has it, so it is not searchable today.
  search / question / hinglish  Gemini writes customer queries for a stratified sample; label = source item.
  abstain  off-topic.
  not_offered  services DocNow does not offer (imaging, ECG, vaccines).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
import sys
from collections import defaultdict
from typing import Any

from google.genai import types

from app.config import Settings
from app.eval.corpus import REAL_DIR, catalog_items
from app.genai_client import get_genai_client
from app.ingestion.catalog_sync import format_catalog_text

CUT = 15  # format_catalog_text keeps constituents[:15]
SEED = 7
SAMPLE = {"PACKAGE": 7, "PROFILE": 20, "TEST": 35}
CONSTITUENT_QUERIES = {"constituent_cut": 30, "constituent_kept": 20}
OFF_TOPIC = [
    "Can you help me book a flight to Mumbai?",
    "What is the weather like in Bangalore today?",
    "Write a poem about the ocean",
    "Do you offer plumbing services?",
    "Who won the cricket match yesterday?",
    "Recommend a laptop under 50000",
    "Translate 'good morning' into French",
    "What is the capital of Australia?",
]
# Services DocNow does not offer (owner-confirmed 21-11-2026): imaging, ECG/ECHO/TMT, vaccinations.
# Hand-checked against the catalog; they sit close to real tests in embedding space (ECG ~ EGFR).
NOT_OFFERED = [
    "How much does a MRI scan of the brain cost?",
    "How much does a chest X-ray cost?",
    "How much does a ultrasound of the abdomen cost?",
    "How much does a ECG at home cost?",
    "Can I book a CT scan of the head?",
    "Do you do 2D echo at home?",
    "TMT test price",
    "Do you give the flu vaccine at home?",
    "Is sonography available for pregnancy?",
    "Book an ECG for my father",
    "knee x-ray kitne ka hai?",
    "PET scan price",
]

PROMPT = """You write realistic search queries that Indian customers type into a diagnostic lab's support chat.

Product:
- name: {name}
- type: {type}
- included tests: {constituents}

Write exactly 3 queries a customer looking for THIS product would type:
1. "search": a short search like people type (lowercase, common abbreviation if one exists, may have a small typo)
2. "question": a natural question about price, fasting or report time that names the product the way a customer would (not copied verbatim)
3. "hinglish": a Hinglish question (Hindi in Latin script mixed with English) about this product

Each query must point at this product specifically, not a whole category. Return JSON: {{"search": "...", "question": "...", "hinglish": "..."}}"""


def clean(name: str) -> str:
    """'Albumin, Serum' -> 'Albumin'; '...-By Elisa Method' -> '...'."""
    name = re.sub(r"-?\s*By [A-Za-z ]+Method$", "", name, flags=re.I)
    return re.sub(r",\s*(Serum|Blood|Plasma|Urine|EDTA Blood|Whole Blood)$", "", name, flags=re.I).strip()


def constituents(item: dict) -> list[str]:
    return [c["name"] for c in (item.get("detailsData") or {}).get("constituents") or []]


def coverage(items: list[dict[str, Any]]) -> dict[str, Any]:
    """Facts production stores vs facts the indexed chunk text actually contains."""
    def share(pred_has, pred_indexed):
        has = [i for i in items if pred_has(i)]
        return {"stored": len(has), "indexed": sum(1 for i in has if pred_indexed(i, format_catalog_text(i)))}

    details = lambda i: i.get("detailsData") or {}
    return {
        "items": len(items),
        "report_time": share(lambda i: details(i).get("reportingTime") or i.get("reportTime"),
                             lambda i, t: "Report Time:" in t),
        "fasting_hours": share(lambda i: details(i).get("fastingTime"),
                               lambda i, t: str(details(i)["fastingTime"]) in t),
        "all_constituents": share(lambda i: constituents(i),
                                  lambda i, t: all(c in t for c in constituents(i))),
        "constituents_lost": sum(1 for i in items for c in constituents(i) if c not in format_catalog_text(i)),
    }


def constituent_queries(items: list[dict], rng: random.Random) -> list[dict]:
    where: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for item in items:
        # Allergy panels list foods and pollens (PLUM, PIGEON FEATHERS) nobody searches for one by one.
        if item["type"] == "TEST" or "allergy" in item["name"].lower():
            continue
        for pos, name in enumerate(constituents(item)):
            where[clean(name).lower()].append((item["id"], pos))
    display = {clean(n).lower(): clean(n) for i in items for n in constituents(i)}
    pools: dict[str, list[dict]] = {"constituent_cut": [], "constituent_kept": []}
    for key, hits in where.items():
        # Keep labels precise: a test listed in many packages has no single right answer in a top 5.
        if not 1 <= len(hits) <= 3 or len(key) < 3:
            continue
        kind = "constituent_cut" if all(pos >= CUT for _, pos in hits) else "constituent_kept"
        pools[kind].append({
            "category": kind,
            "query": f"Which package or profile includes {display[key]}?",
            "relevant": sorted({f"catalog:{item_id}" for item_id, _ in hits}),
        })
    out = []
    for kind, n in CONSTITUENT_QUERIES.items():
        out += rng.sample(pools[kind], min(n, len(pools[kind])))
    return out


async def llm_queries(items: list[dict], rng: random.Random, settings: Settings) -> list[dict]:
    sample = []
    for kind, n in SAMPLE.items():
        pool = [i for i in items if i["type"] == kind]
        sample += rng.sample(pool, min(n, len(pool)))
    client = get_genai_client(settings)
    sem = asyncio.Semaphore(4)

    async def one(item: dict) -> list[dict]:
        names = [clean(c) for c in constituents(item)]
        prompt = PROMPT.format(
            name=item["name"], type=item["type"],
            constituents=", ".join(names[:25]) + (" ..." if len(names) > 25 else "") or "(single test)",
        )
        async with sem:
            resp = await client.aio.models.generate_content(
                model=settings.llm_model, contents=prompt,
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=0.7),
            )
        data = json.loads(resp.text)
        return [
            {"category": kind, "query": data[kind].strip(), "relevant": [f"catalog:{item['id']}"], "source_item": item["name"]}
            for kind in ("search", "question", "hinglish") if data.get(kind)
        ]

    results = await asyncio.gather(*(one(i) for i in sample))
    return [q for qs in results for q in qs]


def abstain_queries(items: list[dict]) -> list[dict]:
    """Off-topic queries must abstain; not-offered ones must say so (the "Services We Don't Offer" doc)."""
    return [{"category": "abstain", "query": q, "relevant": []} for q in OFF_TOPIC] + [
        {"category": "not_offered", "query": q, "relevant": []} for q in NOT_OFFERED
    ]


async def main(args: argparse.Namespace) -> int:
    items = catalog_items("real")
    print(json.dumps(coverage(items), indent=2))
    if args.coverage:
        return 0
    settings = Settings()
    if not settings.gemini_api_key:
        print("SUPPORT_GEMINI_API_KEY is not set.")
        return 2
    rng = random.Random(SEED)
    out = REAL_DIR / "retrieval_set.json"
    if args.constituents_only and out.exists():
        # Rebuild only the data-derived queries; keep the reviewed LLM ones.
        kept = [q for q in json.loads(out.read_text())["queries"] if not q["category"].startswith("constituent")]
        queries = constituent_queries(items, rng) + kept
    else:
        queries = constituent_queries(items, rng) + await llm_queries(items, rng, settings) + abstain_queries(items)
    for n, q in enumerate(queries, 1):
        q["id"] = f"real-{q['category']}-{n:03d}"
    out.write_text(json.dumps({
        "note": f"Generated by build_real_set.py (seed {SEED}) from the production snapshot. Review before trusting.",
        "queries": queries,
    }, indent=2, ensure_ascii=False))
    by_cat = defaultdict(int)
    for q in queries:
        by_cat[q["category"]] += 1
    print(f"Wrote {len(queries)} queries to {out}: {dict(by_cat)}")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--coverage", action="store_true", help="only print indexing coverage")
    parser.add_argument("--constituents-only", action="store_true", help="rebuild constituent queries, keep LLM ones")
    sys.exit(asyncio.run(main(parser.parse_args())))
