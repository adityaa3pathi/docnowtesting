-- Migration: Add AI Support Agent tables
-- Requires pgvector extension

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────
-- KnowledgeChunk: RAG embedding store
-- ─────────────────────────────────────────────
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(768),
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- HNSW index for fast cosine similarity search
CREATE INDEX "KnowledgeChunk_embedding_idx"
    ON "KnowledgeChunk" USING hnsw (embedding vector_cosine_ops);
CREATE INDEX "KnowledgeChunk_source_idx" ON "KnowledgeChunk" ("source");
CREATE INDEX "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk" ("sourceId");

-- ─────────────────────────────────────────────
-- SupportConversation: Chat session tracking
-- ─────────────────────────────────────────────
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportConversation_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "SupportConversation_userId_status_idx"
    ON "SupportConversation" ("userId", "status");
CREATE INDEX "SupportConversation_createdAt_idx"
    ON "SupportConversation" ("createdAt");

-- ─────────────────────────────────────────────
-- SupportMessage: Individual chat messages
-- ─────────────────────────────────────────────
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "conversationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "sources" JSONB,
    "actionsTaken" JSONB,
    "verifierVerdict" TEXT,
    "wasAbstained" BOOLEAN NOT NULL DEFAULT false,
    "tokenCount" INTEGER,
    "latencyMs" INTEGER,
    "langfuseTraceId" TEXT,
    "feedbackScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SupportMessage_conversationId_fkey"
        FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "SupportMessage_conversationId_createdAt_idx"
    ON "SupportMessage" ("conversationId", "createdAt");
