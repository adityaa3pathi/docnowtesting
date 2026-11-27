"""Catalog sync must drop withdrawn tests and re-embed when the embedding setup changes."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.ingestion.catalog_sync import (
    INDEX_SOURCE,
    constituent_index_docs,
    format_catalog_text,
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
        self.index_kept: list[list[str]] = []

    async def fetch(self, sql: str, *args):
        if "DELETE" in sql:
            source = args[1] if len(args) > 1 else "catalog"
            (self.deleted_with if source == "catalog" else self.index_kept).append(list(args[0]))
            return [{"id": "gone-1"}] if source == "catalog" else []
        return self.items

    async def fetchrow(self, sql: str, *args):
        return self.existing.get(args[-1])


def fake_db(conn: FakeConn) -> MagicMock:
    db = MagicMock()
    db.pool = MagicMock()

    @asynccontextmanager
    async def acquire():
        yield conn

    db.pool.acquire = acquire
    db.insert_chunk = AsyncMock()
    db.notify_kb_changed = AsyncMock(return_value=True)
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
async def test_an_empty_catalog_read_never_wipes_the_knowledge_base(settings):
    conn = FakeConn([])
    assert await prune_stale_catalog_chunks(fake_db(conn), []) == 0
    assert conn.deleted_with == []


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


def test_catalog_text_indexes_partner_details_the_top_level_columns_lack():
    """Production rows keep report time, fasting hours and tests only in detailsData (21-11-2026)."""
    item = {
        "name": "Complete Package", "type": "PACKAGE", "displayPrice": 7800, "discountedPrice": 2100,
        "description": None, "reportTime": None,
        "detailsData": {
            "description": "Complete Package", "reportingTime": "26 hrs", "fasting": "Required",
            "fastingTime": "12 hour(s)", "gender": ["Male"],
            "constituents": [{"name": f"Test {i}"} for i in range(86)] + [{"name": "Vitamin D Total-25 Hydroxy"}],
        },
    }
    text = format_catalog_text(item)
    assert "Report Time: 26 hrs" in text
    assert "Fasting Required: Required (12 hour(s))" in text
    assert "For: Male" in text
    assert "Included Tests (87):" in text and "Vitamin D Total-25 Hydroxy" in text
    assert "Description" not in text  # just the name again


def test_catalog_description_drops_html_templates_and_placeholders():
    base = {"name": "Lipid Profile", "type": "TEST", "displayPrice": 500}
    text = format_catalog_text({**base, "description": "Checks cholesterol.<BR>Get tested in {City_Name} today."})
    assert "Description: Checks cholesterol. Get tested today." in text
    assert "Description" not in format_catalog_text({**base, "description": "na"})
    long = format_catalog_text({**base, "description": "word " * 200})
    assert len(long.split("Description: ")[1].split("\n")[0]) <= 404


# ── Shared-test index (Phase 2: list questions) ──


def _pkg(item_id: str, name: str, tests: list[str], kind: str = "PACKAGE", price: float = 999.0) -> dict:
    return {
        **_item(item_id, name), "type": kind, "displayPrice": price,
        "detailsData": {"constituents": [{"name": t} for t in tests]},
    }


def test_index_lists_every_item_that_includes_a_shared_test():
    items = [
        _pkg("p1", "Basic Package", ["Vitamin B12", "TSH"]),
        _pkg("p2", "Full Package", ["Vitamin B12", "TSH", "HbA1c"]),
        _pkg("p3", "Thyroid Profile", ["TSH", "T3"], kind="PROFILE", price=399.0),
        {**_item("t1", "Vitamin B12"), "displayPrice": 567.0},
    ]
    docs = {d["source_id"]: d for d in constituent_index_docs(items)}

    assert set(docs) == {"Vitamin B12", "TSH"}  # HbA1c and T3 sit in one item only
    tsh = docs["TSH"]["content"]
    assert "3 in total. This is the complete list." in tsh
    # Packages first, then profiles
    assert tsh.index("Basic Package") < tsh.index("Full Package") < tsh.index("Thyroid Profile (profile, ₹399)")
    assert "also available as a single test, ₹567" in docs["Vitamin B12"]["content"]


def test_index_ignores_single_test_items_listing_themselves():
    items = [_pkg("t1", "HbA1c", ["HbA1c"], kind="TEST"), _pkg("t2", "HbA1c Fast", ["HbA1c"], kind="TEST")]
    assert constituent_index_docs(items) == []


@pytest.mark.asyncio
async def test_sync_writes_and_prunes_the_index(settings):
    conn = FakeConn([_pkg("p1", "A", ["X", "Y"]), _pkg("p2", "B", ["X", "Z"])])
    db = fake_db(conn)

    with patch("app.ingestion.catalog_sync.generate_embedding", AsyncMock(return_value=[0.1] * 8)):
        stats = await sync_catalog(db, settings)

    written = [c.kwargs for c in db.insert_chunk.await_args_list if c.kwargs["source"] == INDEX_SOURCE]
    assert [w["source_id"] for w in written] == ["X"]
    assert conn.index_kept == [["X"]]
    assert stats["created"] == 3


# Healthians' data for "Lipid Profile (Non Fasting)" (profile_114, prod 2026-11-22).
_NON_FASTING = {
    "id": "i1", "name": "Lipid Profile (Non Fasting)", "type": "PROFILE", "displayPrice": 899, "discountedPrice": 429,
    "partnerCode": "profile_114", "detailsData": {"fasting": "Required", "fastingTime": "12 hour(s)", "constituents": []},
}


def test_catalog_text_uses_healthians_fasting_without_a_correction():
    assert "Fasting Required: Required (12 hour(s))" in format_catalog_text(_NON_FASTING)


def test_a_manager_fasting_correction_replaces_healthians_in_the_chunk():
    fixed = {**_NON_FASTING, "fastingOverride": "Not Required", "fastingTimeOverride": None}
    text = format_catalog_text(fixed)
    assert "Fasting Required: Not Required" in text
    assert "12 hour" not in text


def test_a_required_correction_keeps_only_its_own_hours():
    fixed = {**_NON_FASTING, "fastingOverride": "Required", "fastingTimeOverride": "10 hour(s)"}
    assert "Fasting Required: Required (10 hour(s))" in format_catalog_text(fixed)
    stale = {**_NON_FASTING, "fastingOverride": "Not Required", "fastingTimeOverride": "10 hour(s)"}
    assert "hour" not in format_catalog_text(stale).split("Fasting Required:")[1].split("\n")[0]


def test_sync_query_reads_the_override_columns_tolerantly():
    """Read through to_jsonb, so the AI can deploy before the server migration adds the columns."""
    import inspect

    from app.ingestion import catalog_sync

    source = inspect.getsource(catalog_sync.sync_catalog)
    assert "to_jsonb(c) ->> 'fastingOverride'" in source and "to_jsonb(c) ->> 'fastingTimeOverride'" in source
