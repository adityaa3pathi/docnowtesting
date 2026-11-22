"""Sync CatalogItem rows from PostgreSQL into KnowledgeChunk embeddings."""
from __future__ import annotations

import asyncio
import json
import re
import logging
import uuid
from typing import Any

from app.agents.retrieval import INDEX_SOURCE
from app.config import Settings
from app.database import Database
from app.ingestion.embeddings import DOCUMENT, generate_embedding

logger = logging.getLogger(__name__)


DESCRIPTION_CHARS = 400
_PLACEHOLDER_DESCRIPTIONS = {"na", "n/a", "none", "null", "-"}


def _clean_description(text: Any, name: str) -> str | None:
    """Partner descriptions carry HTML, unfilled {City_Name} templates, "na", or just the name again."""
    if not isinstance(text, str):
        return None
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s*(?:in\s+)?\{[^}]*\}", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    if text.lower() in _PLACEHOLDER_DESCRIPTIONS or text.lower() == name.strip().lower() or len(text) < 4:
        return None
    # Long marketing copy drowns the test list in the embedding; the opening sentences carry the meaning.
    return text if len(text) <= DESCRIPTION_CHARS else text[:DESCRIPTION_CHARS].rsplit(" ", 1)[0] + "..."


def effective_fasting(item: dict[str, Any]) -> tuple[str | None, str | None]:
    """A manager's fasting correction wins over Healthians' detailsData.

    Same rule as server/src/utils/catalogFasting.ts effectiveFasting(); keep them in step.
    """
    if item.get("fastingOverride"):
        hours = item.get("fastingTimeOverride") if item["fastingOverride"] == "Required" else None
        return item["fastingOverride"], hours
    details = item.get("detailsData") if isinstance(item.get("detailsData"), dict) else {}
    return details.get("fasting"), details.get("fastingTime")


def format_catalog_text(item: dict[str, Any]) -> str:
    """Format a CatalogItem row into a text representation for embedding.

    This text is what the retrieval agent will search against.
    """
    parts = [f"Test Name: {item['name']}"]
    parts.append(f"Type: {item['type']}")

    # Pricing
    display_price = item.get("displayPrice")
    discounted = item.get("discountedPrice")
    if discounted and display_price:
        parts.append(f"Price: ₹{discounted} (MRP: ₹{display_price})")
    elif display_price:
        parts.append(f"Price: ₹{display_price}")

    # Healthians puts most facts in detailsData; the top-level columns are usually null (prod, 21-11-2026).
    details = item.get("detailsData") if isinstance(item.get("detailsData"), dict) else {}

    description = _clean_description(item.get("description") or details.get("description"), item["name"])
    if description:
        parts.append(f"Description: {description}")

    if item.get("parameters"):
        parts.append(f"Parameters: {item['parameters']}")

    if item.get("sampleType"):
        parts.append(f"Sample Type: {item['sampleType']}")

    report_time = item.get("reportTime") or details.get("reportingTime")
    if report_time:
        parts.append(f"Report Time: {report_time}")

    fasting, hours = effective_fasting(item)
    if fasting:
        parts.append(f"Fasting Required: {fasting}" + (f" ({hours})" if hours else ""))

    gender = details.get("gender")
    if isinstance(gender, list) and len(gender) == 1:
        parts.append(f"For: {gender[0]}")

    constituents = details.get("constituents")
    if isinstance(constituents, list):
        # Every test, not a preview: "does the package include HbA1c?" is answered from this list,
        # and a cut list made both the answer and the verifier say "not included".
        names = [c.get("name", "") for c in constituents if isinstance(c, dict) and c.get("name")]
        if names:
            parts.append(f"Included Tests ({len(names)}): {', '.join(names)}")

    if details.get("summary"):
        parts.append(f"Summary: {details['summary']}")

    return "\n".join(parts)


# Only tests shared by several items need an index: one item's own chunk already answers for itself.
INDEX_MIN_ITEMS = 2


def _details(item: dict[str, Any]) -> dict[str, Any]:
    return item.get("detailsData") if isinstance(item.get("detailsData"), dict) else {}


def _price(item: dict[str, Any]) -> str:
    price = item.get("discountedPrice") or item.get("displayPrice")
    return f", ₹{price:g}" if isinstance(price, (int, float)) else (f", ₹{price}" if price else "")


def constituent_index_docs(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    """One chunk per test that several packages share: "which packages include B12?" in a single chunk.

    TOP_K=5 item chunks could never list all 8 items with Hemoglobin; this chunk lists every one,
    so the draft can name them all and the verifier can check the list.
    """
    holders: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        constituents = _details(item).get("constituents")
        if not isinstance(constituents, list):
            continue
        names = {c["name"].strip() for c in constituents if isinstance(c, dict) and c.get("name", "").strip()}
        # A single-test item listing itself is the test, not a package containing it.
        if len(names) < 2:
            continue
        for name in names:
            holders.setdefault(name, []).append(item)

    singles = {item["name"].strip().lower(): item for item in items if item.get("type") == "TEST"}
    docs = []
    for name in sorted(holders):
        group = sorted(holders[name], key=lambda i: (i.get("type") != "PACKAGE", i["name"]))
        if len(group) < INDEX_MIN_ITEMS:
            continue
        lines = [f"- {i['name']} ({i.get('type', 'ITEM').lower()}{_price(i)})" for i in group]
        text = (
            f"Packages and profiles that include {name}: {len(group)} in total. This is the complete list.\n"
            + "\n".join(lines)
        )
        single = singles.get(name.lower())
        if single:
            text += f"\n{name} is also available as a single test{_price(single)}."
        docs.append({"source_id": name, "title": f"Packages and profiles with {name}", "content": text})
    return docs


def chunk_is_current(existing: dict | None, text: str, fingerprint: str) -> bool:
    """Unchanged text is still stale if it was embedded with a different model or dimension count."""
    if not existing or existing["content"] != text:
        return False
    metadata = existing.get("metadata")
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except ValueError:
            return False
    return isinstance(metadata, dict) and metadata.get("embedding") == fingerprint


async def prune_stale_catalog_chunks(
    db: Database, live_ids: list[str], source: str = "catalog", allow_empty: bool = False
) -> int:
    """Withdrawn and disabled tests must stop being served; nothing else ever deleted these rows."""
    if not db.pool:
        raise RuntimeError("Database pool not initialized")

    # An empty live list almost always means a wrong database or schema, not an empty catalog;
    # deleting every chunk on that read would blank the bot, so refuse and say so.
    if not live_ids and not allow_empty:
        logger.error("Catalog returned no enabled items; skipping prune so the knowledge base is not wiped")
        return 0

    async with db.pool.acquire() as conn:
        deleted = await conn.fetch(
            """
            DELETE FROM "KnowledgeChunk"
            WHERE source = $2
              AND ("sourceId" IS NULL OR NOT ("sourceId" = ANY($1::text[])))
            RETURNING id
            """,
            live_ids,
            source,
        )
    if deleted:
        logger.info("Removed %d %s chunks whose item is gone or disabled", len(deleted), source)
    return len(deleted)


async def _upsert_chunk(
    db: Database,
    settings: Settings,
    *,
    source: str,
    source_id: str,
    title: str,
    text: str,
    metadata: dict[str, Any],
    stats: dict[str, int],
) -> None:
    """Embed and write one chunk unless the stored copy has the same text and embedding setup."""
    fingerprint = settings.embedding_fingerprint()
    async with db.pool.acquire() as conn:
        existing = await conn.fetchrow(
            """
            SELECT id, content, metadata FROM "KnowledgeChunk"
            WHERE source = $1 AND "sourceId" = $2
            """,
            source,
            source_id,
        )

    if chunk_is_current(dict(existing) if existing else None, text, fingerprint):
        stats["skipped"] += 1
        return

    embedding = await generate_embedding(text, settings, DOCUMENT)
    await db.insert_chunk(
        chunk_id=existing["id"] if existing else str(uuid.uuid4()),
        source=source,
        source_id=source_id,
        title=title,
        content=text,
        embedding=embedding,
        metadata=json.dumps({**metadata, "embedding": fingerprint}),
        version=2 if existing else 1,
    )
    stats["updated" if existing else "created"] += 1


async def sync_catalog(db: Database, settings: Settings) -> dict[str, int]:
    """Sync all enabled CatalogItems, plus the shared-test index, into KnowledgeChunk embeddings.

    Returns stats: {created, updated, skipped, deleted, errors}.
    """
    if not db.pool:
        raise RuntimeError("Database pool not initialized")

    stats = {"created": 0, "updated": 0, "skipped": 0, "deleted": 0, "errors": 0}

    # Fetch all enabled catalog items
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(
            """
            SELECT id, name, type, "displayPrice", "discountedPrice",
                   description, parameters, "sampleType", "reportTime",
                   "partnerCode", "detailsData",
                   -- Read through to_jsonb so the sync keeps working before the server migration adds these columns.
                   to_jsonb(c) ->> 'fastingOverride' AS "fastingOverride",
                   to_jsonb(c) ->> 'fastingTimeOverride' AS "fastingTimeOverride"
            FROM "CatalogItem" c
            WHERE "isEnabled" = true
            """
        )

    logger.info("Found %d enabled catalog items to sync", len(rows))

    items = []
    for row in rows:
        item_dict = dict(row)
        # Parse detailsData JSON if it's a string
        if isinstance(item_dict.get("detailsData"), str):
            try:
                item_dict["detailsData"] = json.loads(item_dict["detailsData"])
            except (json.JSONDecodeError, TypeError):
                item_dict["detailsData"] = None
        items.append(item_dict)

    for item_dict in items:
        try:
            await _upsert_chunk(
                db,
                settings,
                source="catalog",
                source_id=item_dict["id"],
                title=item_dict["name"],
                text=format_catalog_text(item_dict),
                metadata={
                    "name": item_dict["name"],
                    "type": item_dict["type"],
                    "partnerCode": item_dict.get("partnerCode"),
                    "displayPrice": float(item_dict["displayPrice"]) if item_dict.get("displayPrice") else None,
                    "discountedPrice": float(item_dict["discountedPrice"]) if item_dict.get("discountedPrice") else None,
                },
                stats=stats,
            )
        except Exception:
            stats["errors"] += 1
            logger.exception("Failed to sync catalog item: %s", item_dict.get("name"))

    index_docs = constituent_index_docs(items)
    for doc in index_docs:
        try:
            await _upsert_chunk(
                db,
                settings,
                source=INDEX_SOURCE,
                source_id=doc["source_id"],
                title=doc["title"],
                text=doc["content"],
                metadata={"test": doc["source_id"]},
                stats=stats,
            )
        except Exception:
            stats["errors"] += 1
            logger.exception("Failed to sync index chunk: %s", doc["source_id"])

    stats["deleted"] = await prune_stale_catalog_chunks(db, [i["id"] for i in items])
    if items:
        # Unlike an empty catalog, a catalog with no shared tests is real, so an empty index list still prunes.
        stats["deleted"] += await prune_stale_catalog_chunks(
            db, [d["source_id"] for d in index_docs], source=INDEX_SOURCE, allow_empty=True
        )
    return stats


async def run_periodic_catalog_sync(db: Database, settings: Settings) -> None:
    """Keep the bot's prices in step with admin edits; a manual run was the only path before.

    A failure (DB down, embedding quota) is logged and retried on the next tick.
    """
    interval = settings.catalog_sync_interval_seconds
    while True:
        await asyncio.sleep(interval)
        try:
            stats = await sync_catalog(db, settings)
            logger.info("Periodic catalog sync: %s", stats)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Periodic catalog sync failed; retrying in %ds", interval)
