"""Catalog sync must drop withdrawn tests and re-embed when the embedding setup changes."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ingestion.catalog_sync import (
    chunk_is_current,
    prune_stale_catalog_chunks,
    run_periodic_catalog_sync,
    sync_catalog,
)


class FakeConn:
    """Enough of an asyncpg connection to drive sync_catalog without a database."""

    def __init__(self, items: list[dict], existing: dict[str, dict] | None = None) -> None:
        self.items = items
        self.existing = existing or {}
        self.deleted_with: list[list[str]] = []

    async def fetch(self, sql: str, *args):
        if "DELETE" in sql:
            self.deleted_with.append(list(args[0]))
            return [{"id": "gone-1"}]
        return self.items

    async def fetchrow(self, sql: str, *args):
        return self.existing.get(args[0])


def fake_db(conn: FakeConn) -> MagicMock:
    db = MagicMock()
    db.pool = MagicMock()

    @asynccontextmanager
    async def acquire():
        yield conn

    db.pool.acquire = acquire
    db.insert_chunk = AsyncMock()
    return db


def _item(item_id: str, name: str) -> dict:
    return {
        "id": item_id, "name": name, "type": "TEST", "displayPrice": 499.0,
        "discountedPrice": None, "description": None, "parameters": None,
        "sampleType": "Blood", "reportTime": "24h", "partnerCode": "P1", "detailsData": None,
    }


# ── Pruning (finding 1) ───────────────────────


@pytest.mark.asyncio
async def test_sync_prunes_chunks_for_items_that_are_gone_or_disabled(settings):
    conn = FakeConn([_item("c1", "CBC")])
    db = fake_db(conn)

    with patch("app.ingestion.catalog_sync.generate_embedding", AsyncMock(return_value=[0.1] * 8)):
        stats = await sync_catalog(db, settings)

    assert conn.deleted_with == [["c1"]]
    assert stats["deleted"] == 1
    assert stats["created"] == 1


@pytest.mark.asyncio
async def test_pruning_an_empty_catalog_clears_every_catalog_chunk(settings):
    conn = FakeConn([])
    assert await prune_stale_catalog_chunks(fake_db(conn), []) == 1
    assert conn.deleted_with == [[]]


# ── Re-embedding on model change (finding 9) ──


def test_unchanged_text_is_stale_when_the_embedding_setup_changed():
    existing = {"id": "k1", "content": "body", "metadata": json.dumps({"embedding": "old-model@768"})}
    assert chunk_is_current(existing, "body", "old-model@768")
    assert not chunk_is_current(existing, "body", "gemini-embedding-001@768")
    assert not chunk_is_current(existing, "body", "old-model@1536")


def test_a_chunk_with_no_recorded_model_is_re_embedded():
    assert not chunk_is_current({"id": "k1", "content": "body", "metadata": None}, "body", "m@768")
    assert not chunk_is_current(None, "body", "m@768")


def test_changed_text_is_always_stale():
    existing = {"id": "k1", "content": "old", "metadata": json.dumps({"embedding": "m@768"})}
    assert not chunk_is_current(existing, "new", "m@768")


@pytest.mark.asyncio
async def test_sync_records_the_embedding_fingerprint_and_skips_current_chunks(settings):
    item = _item("c1", "CBC")
    conn = FakeConn([item])
    db = fake_db(conn)

    with patch("app.ingestion.catalog_sync.generate_embedding", AsyncMock(return_value=[0.1] * 8)):
        await sync_catalog(db, settings)
        stored = db.insert_chunk.await_args.kwargs
        assert json.loads(stored["metadata"])["embedding"] == settings.embedding_fingerprint()

        # Second run with that chunk already present must not pay for another embedding.
        conn.existing = {"c1": {"id": "k1", "content": stored["content"], "metadata": stored["metadata"]}}
        db.insert_chunk.reset_mock()
        stats = await sync_catalog(db, settings)

    assert stats["skipped"] == 1
    db.insert_chunk.assert_not_awaited()


@pytest.mark.asyncio
async def test_a_failed_item_is_counted_as_an_error(settings):
    conn = FakeConn([_item("c1", "CBC"), _item("c2", "LFT")])
    db = fake_db(conn)

    with patch("app.ingestion.catalog_sync.generate_embedding", AsyncMock(side_effect=RuntimeError("quota"))):
        stats = await sync_catalog(db, settings)

    assert stats["errors"] == 2 and stats["created"] == 0


# ── Background re-sync (finding 1) ────────────


@pytest.mark.asyncio
async def test_periodic_sync_keeps_running_after_a_failure(settings):
    calls = []

    async def flaky(db, s):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("database unreachable")
        return {"created": 0}

    settings.catalog_sync_interval_seconds = 0
    with patch("app.ingestion.catalog_sync.sync_catalog", flaky):
        task = asyncio.create_task(run_periodic_catalog_sync(MagicMock(), settings))
        while len(calls) < 3:
            await asyncio.sleep(0)
        task.cancel()

    assert len(calls) >= 3
