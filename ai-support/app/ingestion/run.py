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
from app.ingestion.catalog_sync import chunk_is_current, sync_catalog
from app.ingestion.embeddings import DOCUMENT, generate_embedding
from app.ingestion.static_docs import STATIC_DOCUMENTS

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger(__name__)


async def ingest_static_docs(db: Database, settings: Settings) -> dict[str, int]:
    """Embed and insert all static FAQ/policy documents."""
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0}
    fingerprint = settings.embedding_fingerprint()

    logger.info("Ingesting %d static documents...", len(STATIC_DOCUMENTS))

    for doc in STATIC_DOCUMENTS:
        existing = None
        try:
            # Deterministic ID based on source + title
            chunk_id = str(
                uuid.uuid5(uuid.NAMESPACE_DNS, f"docnow:{doc['source']}:{doc['title']}")
            )

            # Check if already exists with same content and the same embedding setup
            if db.pool:
                async with db.pool.acquire() as conn:
                    existing = await conn.fetchrow(
                        'SELECT id, content, metadata FROM "KnowledgeChunk" WHERE id = $1',
                        chunk_id,
                    )

                if chunk_is_current(dict(existing) if existing else None, doc["content"], fingerprint):
                    stats["skipped"] += 1
                    logger.debug("Skipped (unchanged): %s", doc["title"])
                    continue

            # Generate embedding
            embedding = await generate_embedding(doc["content"], settings, DOCUMENT)

            await db.insert_chunk(
                chunk_id=chunk_id,
                source=doc["source"],
                source_id=None,
                title=doc["title"],
                content=doc["content"],
                embedding=embedding,
                metadata=json.dumps({"source": doc["source"], "embedding": fingerprint}),
                version=2 if existing else 1,
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


def _print_stats(label: str, stats: dict[str, int]) -> None:
    print(f"   {label}: " + "  ".join(f"{k}={v}" for k, v in stats.items()))


async def main() -> int:
    """Run the full ingestion pipeline; returns the process exit code."""
    args = set(sys.argv[1:])
    do_static = "--static" in args or not args
    do_catalog = "--catalog" in args or not args

    settings = Settings()
    db = Database(settings)
    await db.connect()
    errors = 0

    try:
        print("=" * 60)
        print("DocNow Knowledge Base Ingestion")
        print("=" * 60)

        if do_static:
            print("\n📄 Ingesting static documents (FAQs, policies)...")
            static_stats = await ingest_static_docs(db, settings)
            _print_stats("static", static_stats)
            errors += static_stats["errors"]

        if do_catalog:
            print("\n🧪 Syncing catalog items...")
            catalog_stats = await sync_catalog(db, settings)
            _print_stats("catalog", catalog_stats)
            errors += catalog_stats["errors"]

        # Summary
        if db.pool:
            async with db.pool.acquire() as conn:
                count = await conn.fetchval('SELECT COUNT(*) FROM "KnowledgeChunk"')
                with_emb = await conn.fetchval(
                    'SELECT COUNT(*) FROM "KnowledgeChunk" WHERE embedding IS NOT NULL'
                )
            print(f"\n📊 Total chunks in knowledge base: {count}")
            print(f"   With embeddings: {with_emb}")

        # A zero exit with failed items let a broken cron or deploy step look successful.
        if errors:
            print(f"\n❌ Ingestion finished with {errors} failed item(s); see the log above.")
            return 1

        print("\n✅ Ingestion complete!")
        return 0

    finally:
        await db.disconnect()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
