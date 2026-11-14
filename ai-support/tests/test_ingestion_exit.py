"""Ingestion printed success and exited 0 even when items failed, hiding breakage from cron."""
from __future__ import annotations

import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ingestion import run as ingest_run


def _db() -> MagicMock:
    db = MagicMock()
    db.pool = None
    db.connect = AsyncMock()
    db.disconnect = AsyncMock()
    return db


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "static_errors,catalog_errors,expected",
    [(0, 0, 0), (1, 0, 1), (0, 2, 1), (3, 4, 1)],
)
async def test_exit_code_reflects_failed_items(static_errors, catalog_errors, expected, monkeypatch):
    monkeypatch.setattr(sys, "argv", ["run"])
    static = {"created": 1, "updated": 0, "skipped": 0, "errors": static_errors}
    catalog = {"created": 1, "updated": 0, "skipped": 0, "deleted": 0, "errors": catalog_errors}

    with patch.object(ingest_run, "Database", return_value=_db()), \
         patch.object(ingest_run, "Settings", MagicMock()), \
         patch.object(ingest_run, "ingest_static_docs", AsyncMock(return_value=static)), \
         patch.object(ingest_run, "sync_catalog", AsyncMock(return_value=catalog)):
        assert await ingest_run.main() == expected


@pytest.mark.asyncio
async def test_static_docs_record_the_embedding_fingerprint(settings):
    import json

    db = MagicMock()
    db.pool = None
    db.insert_chunk = AsyncMock()

    with patch.object(ingest_run, "generate_embedding", AsyncMock(return_value=[0.1] * 8)):
        stats = await ingest_run.ingest_static_docs(db, settings)

    assert stats["errors"] == 0 and stats["created"] > 0
    metadata = json.loads(db.insert_chunk.await_args.kwargs["metadata"])
    assert metadata["embedding"] == settings.embedding_fingerprint()
