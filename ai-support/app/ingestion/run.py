"""CLI entry point for knowledge base ingestion.

Usage:
    python -m app.ingestion.run              # Ingest static docs + catalog
    python -m app.ingestion.run --static     # Only static docs
    python -m app.ingestion.run --catalog    # Only catalog items
"""
from __future__ import annotations

import asyncio
import json
import logging
import sys
import uuid

from app.config import Settings
from app.database import Database
from app.ingestion.catalog_sync import sync_catalog
from app.ingestion.embeddings import generate_embedding
from app.ingestion.static_docs import STATIC_DOCUMENTS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def ingest_static_docs(db: Database, settings: Settings) -> dict[str, int]:
    """Embed and insert all static FAQ/policy documents."""
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}

    logger.info("Ingesting %d static documents...", len(STATIC_DOCUMENTS))

    for doc in STATIC_DOCUMENTS:
        try:
            # Deterministic ID based on source + title
            chunk_id = str(
                uuid.uuid5(uuid.NAMESPACE_DNS, f"docnow:{doc['source']}:{doc['title']}")
            )

            # Check if already exists with same content
            if db.pool:
                async with db.pool.acquire() as conn:
                    existing = await conn.fetchrow(
                        'SELECT id, content FROM "KnowledgeChunk" WHERE id = $1',
                        chunk_id,
                    )

                if existing and existing["content"] == doc["content"]:
                    stats["skipped"] += 1
                    logger.debug("Skipped (unchanged): %s", doc["title"])
                    continue

            # Generate embedding
            embedding = await generate_embedding(doc["content"], settings)

            await db.insert_chunk(
                chunk_id=chunk_id,
                source=doc["source"],
                source_id=None,
                title=doc["title"],
                content=doc["content"],
                embedding=embedding,
                metadata=json.dumps({"source": doc["source"]}),
                version=2 if (existing if db.pool else None) else 1,
            )

            if existing:
                stats["updated"] += 1
            else:
                stats["created"] += 1

            logger.info("✓ %s: %s", doc["source"], doc["title"])

        except Exception:
            stats["errors"] += 1
            logger.exception("✗ Failed: %s", doc["title"])

    return stats


async def main() -> None:
    """Run the full ingestion pipeline."""
    args = set(sys.argv[1:])
    do_static = "--static" in args or not args
    do_catalog = "--catalog" in args or not args

    settings = Settings()
    db = Database(settings)
    await db.connect()

    try:
        print("=" * 60)
        print("DocNow Knowledge Base Ingestion")
        print("=" * 60)

        if do_static:
            print("\n📄 Ingesting static documents (FAQs, policies)...")
            static_stats = await ingest_static_docs(db, settings)
            print(f"   Created: {static_stats['created']}")
            print(f"   Updated: {static_stats['updated']}")
            print(f"   Skipped: {static_stats['skipped']}")
            print(f"   Errors:  {static_stats['errors']}")

        if do_catalog:
            print("\n🧪 Syncing catalog items...")
            catalog_stats = await sync_catalog(db, settings)
            print(f"   Created: {catalog_stats['created']}")
            print(f"   Updated: {catalog_stats['updated']}")
            print(f"   Skipped: {catalog_stats['skipped']}")
            print(f"   Errors:  {catalog_stats['errors']}")

        # Summary
        if db.pool:
            async with db.pool.acquire() as conn:
                count = await conn.fetchval('SELECT COUNT(*) FROM "KnowledgeChunk"')
                with_emb = await conn.fetchval(
                    'SELECT COUNT(*) FROM "KnowledgeChunk" WHERE embedding IS NOT NULL'
                )
            print(f"\n📊 Total chunks in knowledge base: {count}")
            print(f"   With embeddings: {with_emb}")

        print("\n✅ Ingestion complete!")

    finally:
        await db.disconnect()


if __name__ == "__main__":
    asyncio.run(main())
