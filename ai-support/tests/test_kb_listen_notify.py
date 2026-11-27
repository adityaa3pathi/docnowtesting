"""Push invalidation: ingestion sends one pg_notify('kb_changed'), the service LISTENs and drops its caches.

Before this, retrieve() and the BM25 index asked the database for the KB version every 10 s on the hot
path, and a re-sync showed up only after that window. Everything here runs on fakes: no database.
"""
from __future__ import annotations

import asyncio
import logging
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app import database
from app.agents import retrieval
from app.agents.retrieval_cache import RetrievalCache
from app.config import Settings
from app.database import KB_CHANNEL, KB_VERSION_SQL, Database
from app.ingestion import catalog_sync
from app.ingestion import run as ingest_run
from app.models import RetrievalResult, RetrievedChunk

ROWS = [
    {"id": "c1", "source": "catalog", "sourceId": "x", "title": "HbA1c", "content": "sugar test", "metadata": None},
    {"id": "c2", "source": "faq", "sourceId": None, "title": "LFT", "content": "liver test", "metadata": None},
]


# ── Fakes ──


class PoolConn:
    """A pooled connection: counts version queries and BM25 rebuilds, logs every write in order."""

    def __init__(self, owner: "FakePool") -> None:
        self.owner = owner

    async def fetchrow(self, sql: str, *args):
        if sql == KB_VERSION_SQL:
            self.owner.version_queries += 1
            return self.owner.version
        return self.owner.existing.get(args[-1]) if args else None

    async def fetch(self, sql: str, *args):
        if sql.lstrip().startswith("DELETE"):
            self.owner.ops.append("delete")
            return [{"id": "gone"}] if self.owner.prunable.pop(args[1], False) else []
        if '"CatalogItem"' in sql:
            if self.owner.catalog_error:
                raise ConnectionError("catalog read failed")
            return self.owner.items
        self.owner.rebuilds += 1
        return ROWS

    async def fetchval(self, sql: str, *args):
        return 0

    async def execute(self, sql: str, *args):
        if "pg_notify" in sql:
            if self.owner.notify_error:
                raise ConnectionError("db down")
            self.owner.ops.append("notify")
            self.owner.notifies.append(args)
        else:
            self.owner.ops.append("write")

    def transaction(self):
        @asynccontextmanager
        async def tx():
            yield

        return tx()


class FakePool:
    def __init__(self, version=(2, "2026-11-27T10:00")) -> None:
        self.version = version
        self.version_queries = 0
        self.rebuilds = 0
        self.ops: list[str] = []
        self.notifies: list[tuple] = []
        self.items: list[dict] = []
        self.existing: dict[str, dict] = {}
        self.prunable: dict[str, bool] = {}
        self.catalog_error = False
        self.notify_error = False

    @asynccontextmanager
    async def _acquire(self):
        yield PoolConn(self)

    def acquire(self):
        return self._acquire()

    async def close(self):
        pass


class ListenConn:
    """The dedicated LISTEN connection asyncpg.connect() returns."""

    def __init__(self, version) -> None:
        self.version = version
        self.version_queries = 0
        self.listeners: dict[str, object] = {}
        self.on_terminate = None
        self.closed = False
        self.ping_fails = False
        self.sync_during_catch_up = False

    async def add_listener(self, channel, callback):
        self.listeners[channel] = callback

    def add_termination_listener(self, callback):
        self.on_terminate = callback

    async def fetchrow(self, sql: str, *args):
        assert sql == KB_VERSION_SQL
        self.version_queries += 1
        version = self.version
        if self.sync_during_catch_up and KB_CHANNEL in self.listeners:
            # A re-sync commits right after this read; Postgres only tells sessions already LISTENing.
            asyncio.get_running_loop().call_soon(self.listeners[KB_CHANNEL], self, 4242, KB_CHANNEL, "")
        return version

    async def fetchval(self, sql: str, *args, timeout=None):
        if self.ping_fails:
            raise ConnectionError("socket gone")
        return 1

    def is_closed(self):
        return self.closed

    async def close(self, timeout=None):
        self._terminated()

    def terminate(self):
        self._terminated()

    # asyncpg delivers both callbacks with loop.call_soon (connection.py, 0.32), not synchronously.
    def _terminated(self):
        if not self.closed:
            self.closed = True
            if self.on_terminate:
                asyncio.get_running_loop().call_soon(self.on_terminate, self)

    async def notify(self):
        asyncio.get_running_loop().call_soon(self.listeners[KB_CHANNEL], self, 4242, KB_CHANNEL, "")
        await asyncio.sleep(0)

    def drop(self):
        """The server or network closed the connection."""
        self._terminated()


def _db(pool: FakePool | None = None, **overrides) -> Database:
    settings = Settings(_env_file=None, kb_listen_health_seconds=0, **overrides)
    db = Database(settings)
    db.pool = pool or FakePool()
    return db


async def _until(predicate, timeout: float = 2.0) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not reached")
        await asyncio.sleep(0.001)


@pytest.fixture(autouse=True)
def fresh_cache():
    retrieval.RETRIEVAL_CACHE = RetrievalCache()
    with patch.object(database, "LISTEN_BACKOFF_MIN", 0.0), patch.object(database, "LISTEN_BACKOFF_MAX", 0.0):
        yield retrieval.RETRIEVAL_CACHE
    retrieval.RETRIEVAL_CACHE = RetrievalCache()


@asynccontextmanager
async def listening(db: Database, *conns: ListenConn, connect_error: Exception | None = None):
    """Run db's listener against these connections, in order; then stop it."""
    queue = list(conns)

    async def connect(*args, **kwargs):
        if queue:
            return queue.pop(0)
        raise connect_error or OSError("connection refused")

    with patch("app.database.asyncpg.connect", side_effect=connect) as connect_mock:
        db.start_kb_listener()
        try:
            yield connect_mock
        finally:
            await db.stop_kb_listener()


HIT = RetrievalResult(chunks=[RetrievedChunk(id="c1", source="catalog", title="CBC", content="", similarity=0.9)])


# ── Listener: notify ──


async def test_notify_clears_the_retrieval_cache_and_bm25_rebuilds_once(fresh_cache):
    db = _db()
    conn = ListenConn(db.pool.version)
    async with listening(db, conn):
        await _until(lambda: db.kb_listening)
        await db.keyword_search("hba1c")
        fresh_cache.put("cbc price", db.settings, await db.kb_version(), HIT)
        before = await db.kb_version()

        await conn.notify()

        assert fresh_cache.entries == {} and fresh_cache.stats()["invalidations"] == 1
        assert await db.kb_version() != before
        await asyncio.gather(*(db.keyword_search("hba1c") for _ in range(5)))
    assert db.pool.rebuilds == 2  # the first build, then exactly one after the notify
    assert db.pool.version_queries == 0
    assert conn.version_queries == 1  # the connect-time catch-up only


async def test_a_search_in_flight_during_a_notify_is_not_served_afterwards(fresh_cache, settings):
    """A result read from the old knowledge base and stored after the notify must not be a hit."""
    db = _db()
    conn = ListenConn(db.pool.version)
    async with listening(db, conn):
        await _until(lambda: db.kb_listening)
        old_version = await db.kb_version()
        await conn.notify()
        fresh_cache.put("cbc price", settings, old_version, HIT)  # the late put
        assert fresh_cache.get("cbc price", settings, await db.kb_version()) is None


async def test_a_sync_during_the_connect_time_check_is_not_missed(fresh_cache, settings):
    """LISTEN goes first, so a re-sync landing between it and the version check still invalidates."""
    db = _db()
    await db.kb_version()  # the fallback has served turns at this version
    fresh_cache.put("cbc price", settings, await db.kb_version(), HIT)
    conn = ListenConn(db.pool.version)
    conn.sync_during_catch_up = True
    async with listening(db, conn):
        await _until(lambda: db.kb_listening)
        await asyncio.sleep(0)
        assert fresh_cache.entries == {}
        assert fresh_cache.get("cbc price", settings, await db.kb_version()) is None


# ── Hot path ──


class SearchDB(Database):
    """The real kb_version and BM25 path; the vector search is canned."""

    async def vector_search(self, embedding, limit=10, *, source=None, exclude_source=None):
        if source == "catalog_index":
            return []
        return [{**ROWS[0], "similarity": 0.9}]


async def test_no_version_query_on_the_hot_path_while_connected(fresh_cache):
    pool = FakePool()
    # TTL 0: the fallback would query on every turn, so zero queries proves the listener path.
    db = SearchDB(Settings(_env_file=None, kb_listen_health_seconds=0, kb_version_ttl_seconds=0))
    db.pool = pool
    conn = ListenConn(pool.version)
    async with listening(db, conn):
        await _until(lambda: db.kb_listening)
        with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 4) as embed:
            for query in ["hba1c price", "lft price", "hba1c price", "HbA1c  price", "sugar test"]:
                await retrieval.retrieve(query, db, db.settings)
    assert pool.version_queries == 0
    assert conn.version_queries == 1
    assert embed.await_count == 3  # 2 of the 5 were cache hits
    assert pool.rebuilds == 1


# ── Reconnect ──


@pytest.mark.parametrize("changed", [True, False])
async def test_reconnect_checks_the_version_once_and_invalidates_only_on_change(fresh_cache, changed, settings):
    db = _db()
    first = ListenConn(db.pool.version)
    second = ListenConn((3, "2026-11-27T11:00") if changed else db.pool.version)
    async with listening(db, first, second) as connect:
        await _until(lambda: db.kb_listening)
        await db.keyword_search("hba1c")
        token = await db.kb_version()
        fresh_cache.put("cbc price", settings, token, HIT)

        first.drop()
        await _until(lambda: connect.call_count == 2 and db.kb_listening)

        assert second.version_queries == 1
        assert (fresh_cache.entries == {}) is changed  # cleared at reconnect, not only on the next lookup
        assert fresh_cache.stats()["invalidations"] == (1 if changed else 0)
        assert (await db.kb_version() != token) is changed
        assert (fresh_cache.get("cbc price", settings, await db.kb_version()) is None) is changed
        await db.keyword_search("hba1c")
    assert db.pool.rebuilds == (2 if changed else 1)
    assert db.pool.version_queries == 0


async def test_a_failed_liveness_ping_reconnects(fresh_cache):
    """A silently dead socket never fires the termination callback; the ping notices it."""
    db = _db()
    db.settings.kb_listen_health_seconds = 0.01
    first, second = ListenConn(db.pool.version), ListenConn(db.pool.version)
    async with listening(db, first, second) as connect:
        await _until(lambda: db.kb_listening)
        first.ping_fails = True
        await _until(lambda: connect.call_count == 2 and db.kb_listening)
    assert first.closed and second.closed


# ── Listener down: fallback ──


async def test_listener_down_falls_back_to_the_ttl_check(fresh_cache):
    db = _db(kb_version_ttl_seconds=10.0)
    async with listening(db) as connect:  # every connect attempt fails
        await _until(lambda: connect.call_count >= 2)
        assert not db.kb_listening
        await db.kb_version()
        await asyncio.sleep(0.01)  # failed reconnect attempts keep running meanwhile
        await db.kb_version()  # within the TTL: reused
        assert db.pool.version_queries == 1
        db._kb_version_at -= 11  # the TTL has passed
        db.pool.version = (3, "2026-11-27T11:00")
        assert (await db.kb_version())[0] == (3, "2026-11-27T11:00")
    assert db.pool.version_queries == 2


async def test_a_dropped_listener_falls_back_at_once(fresh_cache):
    """Notifies may have been missed while it was down, so the first fallback turn asks the database."""
    db = _db(kb_version_ttl_seconds=10.0)
    conn = ListenConn(db.pool.version)
    async with listening(db, conn) as connect:
        await _until(lambda: db.kb_listening)
        conn.drop()
        await _until(lambda: not db.kb_listening and connect.call_count >= 2)
        db.pool.version = (3, "2026-11-27T11:00")  # a re-sync whose notify was lost
        assert (await db.kb_version())[0] == (3, "2026-11-27T11:00")
    assert db.pool.version_queries == 1


async def test_listener_disabled_keeps_the_ttl_check(fresh_cache):
    db = _db(kb_listen_enabled=False)
    with patch("app.database.asyncpg.connect") as connect:
        db.start_kb_listener()
        await db.kb_version()
    connect.assert_not_called()
    assert db.pool.version_queries == 1


# ── Shutdown ──


async def test_shutdown_is_clean(fresh_cache, caplog):
    db = _db()
    conn = ListenConn(db.pool.version)
    caplog.set_level(logging.INFO, logger="app.database")
    async with listening(db, conn):
        await _until(lambda: db.kb_listening)
        task = db._listener_task
    assert task.done()
    assert conn.closed and not db.kb_listening and db._listener_task is None
    assert not [r for r in caplog.records if r.levelno >= logging.WARNING]
    others = [t for t in asyncio.all_tasks() if t is not asyncio.current_task()]
    assert not [t for t in others if t.get_name() == "kb-listener"]
    await db.stop_kb_listener()  # a second stop is a no-op


async def test_shutdown_while_reconnecting_is_clean(fresh_cache):
    db = _db()
    with patch.object(database, "LISTEN_BACKOFF_MIN", 30.0):
        async with listening(db) as connect:
            await _until(lambda: connect.call_count == 1)
            task = db._listener_task
        assert task.done()


async def test_lifespan_stops_the_listener_before_closing_the_pool():
    from app import main

    calls: list[str] = []
    fake = MagicMock()
    fake.connect = AsyncMock(side_effect=lambda: calls.append("connect"))
    fake.start_kb_listener = MagicMock(side_effect=lambda: calls.append("start_listener"))
    fake.stop_kb_listener = AsyncMock(side_effect=lambda: calls.append("stop_listener"))
    fake.disconnect = AsyncMock(side_effect=lambda: calls.append("disconnect"))
    with patch.object(main, "db", fake), patch.object(main, "init_langfuse"), patch.object(main, "shutdown_langfuse"):
        async with main.lifespan(main.app):
            assert calls == ["connect", "start_listener"]
    assert calls == ["connect", "start_listener", "stop_listener", "disconnect"]


# ── Senders: one notify per ingestion run, after the last write ──


def _item(item_id: str, name: str) -> dict:
    return {
        "id": item_id, "name": name, "type": "TEST", "displayPrice": 499.0, "discountedPrice": None,
        "description": None, "parameters": None, "sampleType": "Blood", "reportTime": "24h",
        "partnerCode": "P1", "detailsData": None,
    }


@pytest.fixture
def embed():
    with patch("app.ingestion.catalog_sync.generate_embedding", AsyncMock(return_value=[0.1] * 8)), \
         patch("app.ingestion.run.generate_embedding", AsyncMock(return_value=[0.1] * 8)):
        yield


async def test_catalog_sync_sends_one_notify_after_its_last_write(embed):
    pool = FakePool()
    pool.items = [_item("a", "CBC"), _item("b", "LFT"), _item("c", "KFT")]
    pool.prunable = {"catalog": True}
    db = _db(pool)
    stats = await catalog_sync.sync_catalog(db, db.settings)
    assert stats["created"] == 3 and stats["deleted"] == 1 and stats["errors"] == 0
    assert pool.ops.count("notify") == 1 and pool.ops[-1] == "notify"
    assert pool.notifies == [(KB_CHANNEL,)]


async def test_a_prune_only_sync_still_notifies(embed, settings):
    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    text = catalog_sync.format_catalog_text(_item("a", "CBC"))
    pool.existing = {"a": {"id": "k1", "content": text, "metadata": {"embedding": settings.embedding_fingerprint()}}}
    pool.prunable = {"catalog": True}
    db = _db(pool)
    stats = await catalog_sync.sync_catalog(db, db.settings)
    assert stats["skipped"] == 1 and stats["deleted"] == 1
    assert pool.ops.count("notify") == 1 and pool.ops[-1] == "notify"


async def test_a_sync_that_changes_nothing_sends_no_notify(embed, settings):
    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    fingerprint = settings.embedding_fingerprint()
    text = catalog_sync.format_catalog_text(_item("a", "CBC"))
    pool.existing = {"a": {"id": "k1", "content": text, "metadata": {"embedding": fingerprint}}}
    db = _db(pool)
    stats = await catalog_sync.sync_catalog(db, db.settings)
    assert stats["skipped"] == 1 and stats["errors"] == 0
    assert "notify" not in pool.ops


async def test_a_sync_that_failed_before_writing_sends_no_notify(embed):
    pool = FakePool()
    pool.catalog_error = True
    db = _db(pool)
    with pytest.raises(ConnectionError):
        await catalog_sync.sync_catalog(db, db.settings)
    assert pool.ops == []


async def test_a_sync_that_fails_part_way_still_notifies_for_what_it_wrote(embed):
    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    db = _db(pool)
    with patch.object(catalog_sync, "prune_stale_catalog_chunks", AsyncMock(side_effect=ConnectionError("db down"))):
        with pytest.raises(ConnectionError):
            await catalog_sync.sync_catalog(db, db.settings)
    assert pool.ops == ["write", "notify"]


async def test_a_failed_notify_counts_as_an_error(embed):
    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    pool.notify_error = True
    db = _db(pool)
    stats = await catalog_sync.sync_catalog(db, db.settings)
    assert stats["created"] == 1 and stats["errors"] == 1


async def test_static_ingest_sends_one_notify(embed):
    pool = FakePool()
    db = _db(pool)
    stats = await ingest_run.ingest_static_docs(db, db.settings)
    assert stats["created"] > 1
    assert pool.ops.count("notify") == 1 and pool.ops[-1] == "notify"


async def test_cli_run_sends_one_notify_for_static_and_catalog_together(embed, monkeypatch):
    import sys

    pool = FakePool()
    pool.items = [_item("a", "CBC"), _item("b", "LFT")]
    db = _db(pool)
    db.connect = AsyncMock()
    monkeypatch.setattr(sys, "argv", ["run"])
    with patch.object(ingest_run, "Database", return_value=db), \
         patch.object(ingest_run, "Settings", return_value=db.settings):
        assert await ingest_run.main() == 0
    assert pool.ops.count("write") > 2
    assert pool.ops.count("notify") == 1 and pool.ops[-1] == "notify"


async def test_cli_run_exits_1_when_the_notify_fails(embed, monkeypatch):
    import sys

    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    pool.notify_error = True
    db = _db(pool)
    db.connect = AsyncMock()
    monkeypatch.setattr(sys, "argv", ["run", "--catalog"])
    with patch.object(ingest_run, "Database", return_value=db), \
         patch.object(ingest_run, "Settings", return_value=db.settings):
        assert await ingest_run.main() == 1


async def test_the_periodic_sync_notifies_once_per_run(embed):
    pool = FakePool()
    pool.items = [_item("a", "CBC")]
    db = _db(pool, catalog_sync_interval_seconds=1)
    sleeps = 0

    async def fast_sleep(_):
        nonlocal sleeps
        sleeps += 1
        if sleeps > 1:
            raise asyncio.CancelledError

    with patch("app.ingestion.catalog_sync.asyncio.sleep", fast_sleep):
        with pytest.raises(asyncio.CancelledError):
            await catalog_sync.run_periodic_catalog_sync(db, db.settings)
    assert pool.ops.count("notify") == 1
