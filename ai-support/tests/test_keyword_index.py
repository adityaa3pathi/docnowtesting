"""The BM25 rebuild ran on the event loop and once per concurrent request."""
from __future__ import annotations

import asyncio
import threading
from contextlib import asynccontextmanager
from unittest.mock import MagicMock, patch

import pytest

from app.config import Settings
from app import database
from app.database import Database


class SlowConn:
    """Counts rebuilds and reports one fixed table version."""

    def __init__(self) -> None:
        self.full_fetches = 0

    async def fetchrow(self, sql: str, *args):
        return {"count": 2, "max": "2026-11-08"}

    async def fetch(self, sql: str, *args):
        self.full_fetches += 1
        return [
            {"id": "c1", "source": "catalog", "sourceId": "x", "title": "HbA1c", "content": "sugar test", "metadata": None},
            {"id": "c2", "source": "faq", "sourceId": None, "title": "LFT", "content": "liver test", "metadata": None},
        ]


def _db(conn: SlowConn) -> Database:
    db = Database(Settings(_env_file=None))
    db.pool = MagicMock()

    @asynccontextmanager
    async def acquire():
        yield conn

    db.pool.acquire = acquire
    return db


@pytest.mark.asyncio
async def test_concurrent_searches_rebuild_the_index_once():
    conn = SlowConn()
    db = _db(conn)

    results = await asyncio.gather(*(db.keyword_search("hba1c") for _ in range(5)))

    assert conn.full_fetches == 1
    assert all(r[0]["id"] == "c1" for r in results)


@pytest.mark.asyncio
async def test_an_unchanged_table_is_not_re_read():
    conn = SlowConn()
    db = _db(conn)

    await db.keyword_search("hba1c")
    await db.keyword_search("lft")

    assert conn.full_fetches == 1


@pytest.mark.asyncio
async def test_the_rebuild_does_not_block_the_event_loop():
    """The CPU-bound index build runs in a worker thread, not on the event-loop thread.

    Counting event-loop ticks during the build was racy: a 2-row build can finish before
    the await suspends, so the loop never yields. The build's thread is deterministic.
    """
    built_on: list[int] = []
    real_index = database.BM25Index

    def spy(chunks):
        built_on.append(threading.get_ident())
        return real_index(chunks)

    with patch("app.database.BM25Index", spy):
        await _db(SlowConn()).keyword_search("hba1c")

    assert built_on, "the index was never built"
    assert built_on[0] != threading.get_ident()
