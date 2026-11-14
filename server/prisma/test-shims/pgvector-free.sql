-- Stand-in for the pgvector parts of the schema. The embedded Postgres used by `npm run test:db`
-- has no pgvector, so the embedding column and its hnsw index are left out; no test reads them.
CREATE TABLE IF NOT EXISTS "KnowledgeChunk" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_source_idx" ON "KnowledgeChunk" ("source");
CREATE INDEX IF NOT EXISTS "KnowledgeChunk_sourceId_idx" ON "KnowledgeChunk" ("sourceId");

CREATE TABLE IF NOT EXISTS "SupportConversation" (
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
CREATE INDEX IF NOT EXISTS "SupportConversation_userId_status_idx" ON "SupportConversation" ("userId", "status");
CREATE INDEX IF NOT EXISTS "SupportConversation_createdAt_idx" ON "SupportConversation" ("createdAt");

CREATE TABLE IF NOT EXISTS "SupportMessage" (
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
CREATE INDEX IF NOT EXISTS "SupportMessage_conversationId_createdAt_idx" ON "SupportMessage" ("conversationId", "createdAt");
