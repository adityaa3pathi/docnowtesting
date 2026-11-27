"""Async PostgreSQL connection pool with pgvector support, plus the knowledge-base change listener.

Cache invalidation is push-based: ingestion sends one `pg_notify('kb_changed', '')` after a run that
wrote chunks (notify_kb_changed), and the service holds one dedicated connection that LISTENs on that
channel (start_kb_listener). A notify clears the retrieval cache and makes the next search rebuild BM25.
While the listener is connected the hot path makes no version query at all. When it is down (not yet
connected, or reconnecting) kb_version() falls back to the TTL'd count/max("updatedAt") check, so
results are never stale indefinitely; that fallback runs only while the listener is down. Each
(re)connect checks the version once, which is the only catch-up for notifies missed while it was down.
"""
from __future__ import annotations

import asyncio
import time
import json
import logging
from contextlib import suppress
from typing import Any

import asyncpg
from pgvector.asyncpg import register_vector

from app.agents import retrieval
from app.agents.keyword import BM25Index, rare_title_matches
from app.agents.retrieval import INDEX_SOURCE

HNSW_EF_SEARCH = 200
from app.config import Settings

logger = logging.getLogger(__name__)

KB_CHANNEL = "kb_changed"
KB_VERSION_SQL = 'SELECT count(*), max("updatedAt") FROM "KnowledgeChunk"'
# Listener reconnect backoff, doubling from MIN to MAX seconds.
LISTEN_BACKOFF_MIN = 1.0
LISTEN_BACKOFF_MAX = 60.0
LISTEN_CONNECT_TIMEOUT = 15.0
LISTEN_CLOSE_TIMEOUT = 5.0
# Shows the listener in pg_stat_activity.
LISTEN_APPLICATION_NAME = "ai-support-kb-listener"


def decode_json_field(row: dict[str, Any], field: str) -> None:
    """asyncpg hands jsonb back as text; decode in place so callers get real lists and dicts."""
    value = row.get(field)
    if isinstance(value, str):
        try:
            row[field] = json.loads(value)
        except ValueError:
            logger.warning("Row %s has unreadable %s; ignoring it", row.get("id"), field)
            row[field] = None


def chunk_row(record: Any) -> dict[str, Any]:
    """A KnowledgeChunk row as a dict, with its jsonb metadata decoded."""
    row = dict(record)
    decode_json_field(row, "metadata")
    return row


def message_row(record: Any) -> dict[str, Any]:
    """A SupportMessage row as a dict, with its jsonb columns decoded."""
    row = dict(record)
    decode_json_field(row, "sources")
    decode_json_field(row, "actionsTaken")
    return row


class Database:
    """Manages an asyncpg connection pool with pgvector type registration."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.pool: asyncpg.Pool | None = None
        self._bm25: BM25Index | None = None
        self._bm25_version: tuple | None = None
        self._bm25_lock = asyncio.Lock()
        # Last DB version seen (fallback check or listener catch-up), and how many invalidations
        # (notifies, or a changed version on reconnect) happened since. kb_version() returns both.
        self._kb_version: tuple | None = None
        self._kb_version_at = 0.0
        self._kb_generation = 0
        self._kb_listening = False
        self._listener_task: asyncio.Task | None = None
        # Chunk writes since the last notify; ingestion sends one notify per run when this is non-zero.
        self._kb_writes = 0

    async def connect(self) -> None:
        """Create the connection pool and register pgvector types."""
        logger.info("Connecting to PostgreSQL: %s", self.settings.database_url[:40] + "...")
        self.pool = await asyncpg.create_pool(
            self.settings.database_url,
            min_size=2,
            max_size=10,
            init=self._init_connection,
        )
        logger.info("Database connection pool created (min=2, max=10)")

    async def _init_connection(self, conn: asyncpg.Connection) -> None:
        """Register pgvector type codec on each new connection."""
        await register_vector(conn)

    async def disconnect(self) -> None:
        """Close the connection pool (and the listener, if the caller has not stopped it already)."""
        await self.stop_kb_listener()
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed")

    async def vector_search(
        self,
        embedding: list[float],
        limit: int = 10,
        *,
        source: str | None = None,
        exclude_source: str | None = None,
    ) -> list[dict[str, Any]]:
        """Cosine similarity search over KnowledgeChunk table.

        Returns chunks ordered by descending similarity (1 = identical).
        The <=> operator returns cosine distance; similarity = 1 - distance.
        source / exclude_source keep only, or drop, one source (the item and index lanes).
        """
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call connect() first.")

        async with self.pool.acquire() as conn, conn.transaction():
            # HNSW filters after the scan, and the scan returns ef_search rows (default 40): with a
            # source filter that can leave too few. The table is a few hundred rows, so scan wider.
            await conn.execute(f"SET LOCAL hnsw.ef_search = {HNSW_EF_SEARCH}")
            rows = await conn.fetch(
                """
                SELECT id, source, "sourceId", title, content, metadata,
                       1 - (embedding <=> $1::vector) AS similarity
                FROM "KnowledgeChunk"
                WHERE embedding IS NOT NULL
                  AND ($3::text IS NULL OR source = $3)
                  AND ($4::text IS NULL OR source <> $4)
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                embedding,
                limit,
                source,
                exclude_source,
            )
            return [chunk_row(r) for r in rows]

    async def rare_title_search(self, query: str, limit: int = 5) -> list[dict[str, Any]]:
        """Rescue lane for bare codes the dense gate rejected; see keyword.rare_title_matches."""
        await self._ensure_bm25()
        return rare_title_matches(self._bm25, query, limit)

    async def keyword_search(self, query: str, limit: int = 20) -> list[dict[str, Any]]:
        """BM25 over all chunks; the index is rebuilt only when ingestion has changed the table."""
        await self._ensure_bm25()
        return self._bm25.search(query, limit)

    @property
    def kb_listening(self) -> bool:
        """True while the kb_changed listener is connected and caught up."""
        return self._kb_listening

    def _kb_token(self) -> tuple:
        return (self._kb_version, self._kb_generation)

    async def kb_version(self) -> tuple:
        """The knowledge-base version the retrieval cache and the BM25 index are keyed on.

        It changes when a kb_changed notify arrives, and when the row count or newest "updatedAt" of
        KnowledgeChunk changes (upserts bump "updatedAt"). While the listener is connected this makes no
        query. While it is down, the count/max query runs, remembered for kb_version_ttl_seconds so the
        BM25 index and the cache share one query every few seconds; that is the fallback, not a poll.
        """
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call connect() first.")
        if self._kb_listening:
            return self._kb_token()
        ttl = getattr(self.settings, "kb_version_ttl_seconds", 0.0)
        if self._kb_version is not None and time.monotonic() - self._kb_version_at < ttl:
            return self._kb_token()
        async with self.pool.acquire() as conn:
            version = tuple(await conn.fetchrow(KB_VERSION_SQL))
        self._kb_version, self._kb_version_at = version, time.monotonic()
        return self._kb_token()

    async def _ensure_bm25(self) -> None:
        """The index is rebuilt only when the knowledge-base version has changed (see kb_version)."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call connect() first.")

        version = await self.kb_version()
        if self._bm25 is None or version != self._bm25_version:
            # The lock makes concurrent requests wait for one rebuild instead of each doing its own.
            async with self._bm25_lock:
                if self._bm25 is None or version != self._bm25_version:
                    async with self.pool.acquire() as conn:
                        await self._rebuild_bm25(conn, version)

    async def _rebuild_bm25(self, conn: asyncpg.Connection, version: tuple) -> None:
        """Tokenising the whole corpus is CPU-bound, so it runs off the event loop."""
        rows = await conn.fetch(
            # Index chunks repeat every package and test name; BM25 serves the item lane only.
            'SELECT id, source, "sourceId", title, content, metadata FROM "KnowledgeChunk" WHERE source <> $1',
            INDEX_SOURCE,
        )
        chunks = [chunk_row(r) for r in rows]
        self._bm25 = await asyncio.to_thread(BM25Index, chunks)
        self._bm25_version = version

    async def insert_chunk(
        self,
        *,
        chunk_id: str,
        source: str,
        source_id: str | None,
        title: str,
        content: str,
        embedding: list[float],
        metadata: dict | None = None,
        version: int = 1,
    ) -> None:
        """Insert or update a knowledge chunk with its embedding."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call connect() first.")

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO "KnowledgeChunk" (id, source, "sourceId", title, content, embedding, metadata, version, "createdAt", "updatedAt")
                VALUES ($1, $2, $3, $4, $5, $6::vector, $7::jsonb, $8, NOW(), NOW())
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    content = EXCLUDED.content,
                    embedding = EXCLUDED.embedding,
                    metadata = EXCLUDED.metadata,
                    version = EXCLUDED.version,
                    "updatedAt" = NOW()
                """,
                chunk_id,
                source,
                source_id,
                title,
                content,
                embedding,
                metadata,
                version,
            )
        self._kb_writes += 1

    # ── Knowledge-base change notifications ──

    def note_kb_writes(self, count: int = 1) -> None:
        """Record chunk writes made outside insert_chunk (the catalog prune's DELETE)."""
        self._kb_writes += count

    async def notify_kb_changed(self) -> bool:
        """Send one kb_changed notify if chunks were written since the last one; call it after a run's last write.

        Returns False only when the notify failed: running services then keep serving their caches until
        their listener reconnects, so ingestion counts that as a failed item.
        """
        if not self._kb_writes:
            return True
        # Never raises: it runs in ingestion's finally blocks, where it must not hide the real error.
        try:
            if not self.pool:
                raise RuntimeError("Database pool not initialized")
            async with self.pool.acquire() as conn:
                await conn.execute("SELECT pg_notify($1, '')", KB_CHANNEL)
        except Exception as exc:
            logger.error(
                "kb_changed notify failed after %d chunk write(s) (%s); running services will not see this sync "
                "until their listener reconnects", self._kb_writes, type(exc).__name__,
            )
            return False
        logger.info("Sent kb_changed after %d chunk write(s)", self._kb_writes)
        self._kb_writes = 0
        return True

    def _invalidate_kb(self, reason: str) -> None:
        """Drop the cached search results and make the next search rebuild BM25 (a new version token)."""
        self._kb_generation += 1
        retrieval.RETRIEVAL_CACHE.clear()
        logger.info("Knowledge base changed (%s): retrieval cache cleared, BM25 rebuilds on the next search", reason)

    def _on_kb_notify(self, conn: Any, pid: int, channel: str, payload: str) -> None:
        self._invalidate_kb("kb_changed notify")

    def start_kb_listener(self) -> None:
        """Start the background task that holds the LISTEN connection; kb_version falls back until it connects."""
        if not getattr(self.settings, "kb_listen_enabled", True):
            logger.info("kb_changed listener disabled; using the %ss version check", self.settings.kb_version_ttl_seconds)
            return
        if self._listener_task is None or self._listener_task.done():
            self._listener_task = asyncio.create_task(self._listen_forever(), name="kb-listener")

    async def stop_kb_listener(self) -> None:
        """Cancel the listener task and wait for it to close its connection."""
        task, self._listener_task = self._listener_task, None
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
        logger.info("kb_changed listener stopped")

    async def _listen_forever(self) -> None:
        """Hold one dedicated connection (not from the pool) on LISTEN kb_changed, reconnecting with backoff."""
        delay = LISTEN_BACKOFF_MIN
        while True:
            conn: asyncpg.Connection | None = None
            lost = asyncio.Event()
            try:
                conn = await asyncpg.connect(
                    self.settings.database_url,
                    timeout=LISTEN_CONNECT_TIMEOUT,
                    server_settings={"application_name": LISTEN_APPLICATION_NAME},
                )
                # Bound now: a late callback from a closed connection must not trip the next one's event.
                conn.add_termination_listener(lambda _conn, lost=lost: lost.set())
                # LISTEN before the catch-up check, so a notify sent between the two is not missed.
                await conn.add_listener(KB_CHANNEL, self._on_kb_notify)
                await self._catch_up(conn)
                self._kb_listening = True
                delay = LISTEN_BACKOFF_MIN
                logger.info("Listening on %s; retrieval makes no version query while connected", KB_CHANNEL)
                await self._wait_until_lost(conn, lost)
                logger.warning(
                    "kb_changed listener connection lost; using the %ss version check until it reconnects",
                    self.settings.kb_version_ttl_seconds,
                )
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                # The exception type and message only: never the connection string.
                logger.warning("kb_changed listener unavailable (%s: %s); retrying in %.0fs",
                               type(exc).__name__, str(exc)[:200], delay)
            finally:
                if self._kb_listening:
                    self._kb_listening = False
                    # Notifies may have been missed: the fallback must ask the database on the next turn.
                    self._kb_version_at = 0.0
                if conn is not None:
                    await self._close_listener(conn)
            await asyncio.sleep(delay)
            delay = min(delay * 2, LISTEN_BACKOFF_MAX)

    async def _catch_up(self, conn: asyncpg.Connection) -> None:
        """One version check per (re)connect: the only way a notify missed while disconnected is noticed."""
        version = tuple(await conn.fetchrow(KB_VERSION_SQL))
        if self._kb_version is not None and version != self._kb_version:
            self._invalidate_kb("version changed while the listener was down")
        self._kb_version, self._kb_version_at = version, time.monotonic()

    async def _wait_until_lost(self, conn: asyncpg.Connection, lost: asyncio.Event) -> None:
        """Returns when the connection drops: asyncpg's termination callback, or a failed liveness ping.

        The ping (SELECT 1 on the listener's own connection) only catches a silently dead socket. It never
        reads KnowledgeChunk and never invalidates anything.
        """
        health = getattr(self.settings, "kb_listen_health_seconds", 0.0)
        while True:
            try:
                await asyncio.wait_for(lost.wait(), timeout=health if health > 0 else None)
                return
            except TimeoutError:
                pass
            if conn.is_closed():
                return
            try:
                await conn.fetchval("SELECT 1", timeout=LISTEN_CONNECT_TIMEOUT)
            except asyncio.CancelledError:
                raise
            except Exception:
                return

    async def _close_listener(self, conn: asyncpg.Connection) -> None:
        if conn.is_closed():
            return
        try:
            await asyncio.wait_for(conn.close(), timeout=LISTEN_CLOSE_TIMEOUT)
        except asyncio.CancelledError:
            conn.terminate()
            raise
        except Exception:
            conn.terminate()

    async def get_user_auth_state(self, user_id: str) -> dict | None:
        """status and tokenVersion for the Express-equivalent auth check; None when the user is gone."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                'SELECT status, "tokenVersion" FROM "User" WHERE id = $1',
                user_id,
            )
            return dict(row) if row else None

    async def get_conversation(self, conversation_id: str, user_id: str) -> dict | None:
        """Fetch a conversation with ownership check."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT id, "userId", status, summary, "createdAt", "updatedAt"
                FROM "SupportConversation"
                WHERE id = $1 AND "userId" = $2
                """,
                conversation_id,
                user_id,
            )
            return dict(row) if row else None

    async def create_conversation(self, user_id: str) -> str:
        """Create a new support conversation, return its ID."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "SupportConversation" ("userId", "createdAt", "updatedAt")
                VALUES ($1, NOW(), NOW())
                RETURNING id
                """,
                user_id,
            )
            return row["id"]  # type: ignore[index]

    async def add_message(
        self,
        *,
        conversation_id: str,
        role: str,
        content: str,
        sources: Any | None = None,
        actions_taken: Any | None = None,
        verifier_verdict: str | None = None,
        was_abstained: bool = False,
        token_count: int | None = None,
        latency_ms: int | None = None,
        langfuse_trace_id: str | None = None,
    ) -> str:
        """Insert a message into a conversation, return message ID."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        import json

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO "SupportMessage" (
                    "conversationId", role, content, sources, "actionsTaken",
                    "verifierVerdict", "wasAbstained", "tokenCount", "latencyMs",
                    "langfuseTraceId", "createdAt"
                )
                VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, NOW())
                RETURNING id
                """,
                conversation_id,
                role,
                content,
                json.dumps(sources) if sources else None,
                json.dumps(actions_taken) if actions_taken else None,
                verifier_verdict,
                was_abstained,
                token_count,
                latency_ms,
                langfuse_trace_id,
            )
            return row["id"]  # type: ignore[index]

    async def get_conversation_messages(
        self,
        conversation_id: str,
        limit: int = 20,
    ) -> list[dict]:
        """Fetch recent messages for a conversation."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, role, content, sources, "actionsTaken",
                       "verifierVerdict", "wasAbstained", "feedbackScore", "createdAt"
                FROM "SupportMessage"
                WHERE "conversationId" = $1
                ORDER BY "createdAt" ASC
                LIMIT $2
                """,
                conversation_id,
                limit,
            )
            return [message_row(r) for r in rows]

    async def get_recent_messages(self, conversation_id: str, limit: int) -> list[dict]:
        """The latest `limit` messages, oldest first, with only what prompts need."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT role, content, "actionsTaken", "createdAt"
                FROM "SupportMessage"
                WHERE "conversationId" = $1
                ORDER BY "createdAt" DESC
                LIMIT $2
                """,
                conversation_id,
                limit,
            )
            return [dict(r) for r in reversed(rows)]

    async def count_user_messages(self, conversation_id: str) -> int:
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            return await conn.fetchval(
                """SELECT count(*) FROM "SupportMessage" WHERE "conversationId" = $1 AND role = 'user'""",
                conversation_id,
            )

    async def update_feedback(self, message_id: str, user_id: str, score: int) -> dict | None:
        """Set feedback score (1=thumbs down, 5=thumbs up) on a message the user owns.

        Returns {"langfuseTraceId": ...} when updated, None when the message is not theirs.
        """
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE "SupportMessage" m SET "feedbackScore" = $1
                FROM "SupportConversation" c
                WHERE m.id = $2 AND m.role = 'assistant'
                  AND c.id = m."conversationId" AND c."userId" = $3
                RETURNING m."langfuseTraceId"
                """,
                score,
                message_id,
                user_id,
            )
            return dict(row) if row else None
