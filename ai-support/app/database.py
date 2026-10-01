"""Async PostgreSQL connection pool with pgvector support."""
from __future__ import annotations

import logging
from typing import Any

import asyncpg
from pgvector.asyncpg import register_vector

from app.config import Settings

logger = logging.getLogger(__name__)


class Database:
    """Manages an asyncpg connection pool with pgvector type registration."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.pool: asyncpg.Pool | None = None

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
        """Close the connection pool."""
        if self.pool:
            await self.pool.close()
            logger.info("Database connection pool closed")

    async def vector_search(
        self,
        embedding: list[float],
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        """Cosine similarity search over KnowledgeChunk table.

        Returns chunks ordered by descending similarity (1 = identical).
        The <=> operator returns cosine distance; similarity = 1 - distance.
        """
        if not self.pool:
            raise RuntimeError("Database pool not initialized. Call connect() first.")

        async with self.pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id, source, "sourceId", title, content, metadata,
                       1 - (embedding <=> $1::vector) AS similarity
                FROM "KnowledgeChunk"
                WHERE embedding IS NOT NULL
                ORDER BY embedding <=> $1::vector
                LIMIT $2
                """,
                embedding,
                limit,
            )
            return [dict(r) for r in rows]

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
            return [dict(r) for r in rows]

    async def update_feedback(self, message_id: str, score: int) -> None:
        """Set feedback score on a message (1=thumbs down, 5=thumbs up)."""
        if not self.pool:
            raise RuntimeError("Database pool not initialized.")

        async with self.pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE "SupportMessage" SET "feedbackScore" = $1
                WHERE id = $2
                """,
                score,
                message_id,
            )
