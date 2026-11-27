"""Phase 4: retrieval cache (results only, invalidated when the knowledge base changes)."""
from __future__ import annotations

from types import SimpleNamespace

from app.agents.retrieval_cache import RetrievalCache, normalize
from app.models import RetrievalResult, RetrievedChunk

SETTINGS = SimpleNamespace(embedding_model="e", embedding_dimensions=768, relevance_threshold=0.58,
                           bm25_rescue_enabled=False, rerank_enabled=False, rerank_min_score=0.0,
                           rerank_candidates=20, rerank_model="m")
HIT = RetrievalResult(chunks=[RetrievedChunk(id="c1", source="catalog", title="CBC", content="₹299", similarity=0.8)],
                      max_similarity=0.8)


def test_normalize_ignores_case_and_spacing_only():
    assert normalize("  How much is  CBC? ") == normalize("how much is cbc?")
    assert normalize("how much is cbc") != normalize("how much is cbc?")


def test_hit_after_put_and_copy_is_independent():
    cache = RetrievalCache()
    assert cache.get("How much is CBC?", SETTINGS, version=(1, "t1")) is None
    cache.put("How much is CBC?", SETTINGS, (1, "t1"), HIT)
    got = cache.get("how much is cbc?", SETTINGS, (1, "t1"))
    assert got == HIT
    got.chunks.clear()  # a caller mutating its copy must not change the cache
    assert cache.get("how much is cbc?", SETTINGS, (1, "t1")) == HIT
    assert cache.stats()["hits"] == 2 and cache.stats()["misses"] == 1


def test_new_knowledge_base_version_drops_every_entry():
    cache = RetrievalCache()
    cache.put("cbc price", SETTINGS, (529, "t1"), HIT)
    assert cache.get("cbc price", SETTINGS, (529, "t2")) is None  # a sync bumped updatedAt
    assert cache.stats()["invalidations"] == 1 and cache.stats()["entries"] == 0


def test_settings_that_change_retrieval_are_part_of_the_key():
    cache = RetrievalCache()
    cache.put("cbc price", SETTINGS, (1, "t"), HIT)
    stricter = SimpleNamespace(**{**vars(SETTINGS), "relevance_threshold": 0.7})
    assert cache.get("cbc price", stricter, (1, "t")) is None


def test_failed_search_is_never_cached():
    cache = RetrievalCache()
    cache.put("cbc price", SETTINGS, (1, "t"), RetrievalResult(failed=True, should_abstain=True))
    assert cache.get("cbc price", SETTINGS, (1, "t")) is None


def test_least_recently_used_entry_is_evicted():
    cache = RetrievalCache(max_entries=2)
    for q in ("a", "b"):
        cache.put(q, SETTINGS, (1, "t"), HIT)
    cache.get("a", SETTINGS, (1, "t"))
    cache.put("c", SETTINGS, (1, "t"), HIT)
    assert cache.get("b", SETTINGS, (1, "t")) is None
    assert cache.get("a", SETTINGS, (1, "t")) is not None


def test_size_zero_turns_the_cache_off():
    cache = RetrievalCache(max_entries=0)
    cache.put("a", SETTINGS, (1, "t"), HIT)
    assert cache.get("a", SETTINGS, (1, "t")) is None


# ── Wired into retrieve() ──

import pytest  # noqa: E402
from unittest.mock import AsyncMock, patch  # noqa: E402

from app.agents import retrieval  # noqa: E402


class VersionedDB:
    def __init__(self):
        self.version = (529, "2026-11-21T17:46")
        self.vector_calls = 0

    async def kb_version(self):
        return self.version

    async def vector_search(self, embedding, limit=10, *, source=None, exclude_source=None):
        self.vector_calls += 1
        if source == "catalog_index":
            return []
        return [{"id": "c1", "source": "catalog", "title": "CBC", "content": "₹299", "similarity": 0.8}]

    async def keyword_search(self, query, limit=20):
        return []

    async def rare_title_search(self, query, limit=5):
        return []


@pytest.fixture
def fresh_cache():
    retrieval.RETRIEVAL_CACHE = RetrievalCache()
    yield retrieval.RETRIEVAL_CACHE
    retrieval.RETRIEVAL_CACHE = RetrievalCache()


async def test_second_identical_search_is_served_from_the_cache(settings, fresh_cache):
    db = VersionedDB()
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 4) as embed:
        first = await retrieval.retrieve("How much is CBC?", db, settings)
        second = await retrieval.retrieve("how much is  cbc?", db, settings)
    assert [c.id for c in second.chunks] == [c.id for c in first.chunks] == ["c1"]
    assert embed.await_count == 1 and db.vector_calls == 2  # one search (two lanes), not two
    assert fresh_cache.stats()["hits"] == 1


async def test_catalog_sync_invalidates_the_cache(settings, fresh_cache):
    db = VersionedDB()
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 4) as embed:
        await retrieval.retrieve("cbc price", db, settings)
        db.version = (529, "2026-11-22T09:00")  # a re-sync upserted chunks
        await retrieval.retrieve("cbc price", db, settings)
    assert embed.await_count == 2
    assert fresh_cache.stats()["invalidations"] == 1


async def test_size_zero_setting_turns_the_cache_off(settings, fresh_cache):
    settings.retrieval_cache_size = 0
    db = VersionedDB()
    with patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 4) as embed:
        await retrieval.retrieve("cbc price", db, settings)
        await retrieval.retrieve("cbc price", db, settings)
    assert embed.await_count == 2


async def test_failed_version_check_still_answers(settings, fresh_cache):
    db = VersionedDB()

    async def broken(self):
        raise ConnectionError("db down")

    with patch.object(VersionedDB, "kb_version", broken), \
         patch("app.agents.retrieval.generate_embedding", new_callable=AsyncMock, return_value=[0.1] * 4):
        result = await retrieval.retrieve("cbc price", db, settings)
    assert [c.id for c in result.chunks] == ["c1"]
    assert fresh_cache.stats()["hits"] == fresh_cache.stats()["misses"] == 0


async def test_database_version_check_is_shared_for_its_ttl(settings):
    from contextlib import asynccontextmanager
    from unittest.mock import MagicMock

    from app.database import Database

    conn = MagicMock()
    conn.fetchrow = AsyncMock(side_effect=[(529, "t1"), (530, "t2")])

    @asynccontextmanager
    async def acquire():
        yield conn

    db = Database(settings)
    db.pool = MagicMock(acquire=acquire)
    settings.kb_version_ttl_seconds = 10.0
    with patch("app.database.time.monotonic", side_effect=[100.0, 105.0, 111.0, 111.0]):
        # The listener is not connected, so this is the TTL'd fallback; 0 = no notify received yet.
        assert await db.kb_version() == ((529, "t1"), 0)
        assert await db.kb_version() == ((529, "t1"), 0)  # 5 s later: reused, no query
        assert await db.kb_version() == ((530, "t2"), 0)  # 11 s later: asked again, sees the sync
    assert conn.fetchrow.await_count == 2
