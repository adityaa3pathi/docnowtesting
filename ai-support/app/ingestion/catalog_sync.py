"""Sync CatalogItem rows from PostgreSQL into KnowledgeChunk embeddings."""
from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.config import Settings
from app.database import Database
from app.ingestion.embeddings import generate_embedding

logger = logging.getLogger(__name__)


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

    if item.get("description"):
        parts.append(f"Description: {item['description']}")

    if item.get("parameters"):
        parts.append(f"Parameters: {item['parameters']}")

    if item.get("sampleType"):
        parts.append(f"Sample Type: {item['sampleType']}")

    if item.get("reportTime"):
        parts.append(f"Report Time: {item['reportTime']}")

    # Rich details from detailsData (cached Healthians product details)
    details = item.get("detailsData")
    if details and isinstance(details, dict):
        if details.get("fasting"):
            parts.append(f"Fasting Required: {details['fasting']}")
        if details.get("constituents"):
            constituents = details["constituents"]
            if isinstance(constituents, list):
                names = [c.get("name", "") for c in constituents[:15]]
                parts.append(f"Included Tests: {', '.join(n for n in names if n)}")
        if details.get("summary"):
            parts.append(f"Summary: {details['summary']}")

    return "\n".join(parts)


async def sync_catalog(db: Database, settings: Settings) -> dict[str, int]:
    """Sync all enabled CatalogItems into KnowledgeChunk embeddings.

    Returns stats: {created, updated, skipped, errors}.
    """
    if not db.pool:
        raise RuntimeError("Database pool not initialized")

    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

    # Fetch all enabled catalog items
    async with db.pool.acquire() as conn:
        items = await conn.fetch(
            """
            SELECT id, name, type, "displayPrice", "discountedPrice",
                   description, parameters, "sampleType", "reportTime",
                   "partnerCode", "detailsData"
            FROM "CatalogItem"
            WHERE "isEnabled" = true
            """
        )

    logger.info("Found %d enabled catalog items to sync", len(items))

    for item in items:
        item_dict = dict(item)
        # Parse detailsData JSON if it's a string
        if isinstance(item_dict.get("detailsData"), str):
            try:
                item_dict["detailsData"] = json.loads(item_dict["detailsData"])
            except (json.JSONDecodeError, TypeError):
                item_dict["detailsData"] = None

        try:
            text = format_catalog_text(item_dict)

            # Check if chunk already exists with same content
            async with db.pool.acquire() as conn:
                existing = await conn.fetchrow(
                    """
                    SELECT id, content FROM "KnowledgeChunk"
                    WHERE source = 'catalog' AND "sourceId" = $1
                    """,
                    item_dict["id"],
                )

            if existing and existing["content"] == text:
                stats["skipped"] += 1
                continue

            # Generate embedding
            embedding = await generate_embedding(text, settings)

            # Build metadata
            metadata = json.dumps({
                "name": item_dict["name"],
                "type": item_dict["type"],
                "partnerCode": item_dict.get("partnerCode"),
                "displayPrice": float(item_dict["displayPrice"]) if item_dict.get("displayPrice") else None,
                "discountedPrice": float(item_dict["discountedPrice"]) if item_dict.get("discountedPrice") else None,
            })

            chunk_id = existing["id"] if existing else str(uuid.uuid4())
            version = 2 if existing else 1

            await db.insert_chunk(
                chunk_id=chunk_id,
                source="catalog",
                source_id=item_dict["id"],
                title=item_dict["name"],
                content=text,
                embedding=embedding,
                metadata=metadata,
                version=version,
            )

            if existing:
                stats["updated"] += 1
                logger.debug("Updated chunk for: %s", item_dict["name"])
            else:
                stats["created"] += 1
                logger.debug("Created chunk for: %s", item_dict["name"])

        except Exception:
            stats["errors"] += 1
            logger.exception("Failed to sync catalog item: %s", item_dict.get("name"))

    return stats
