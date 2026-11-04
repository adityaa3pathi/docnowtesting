-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "searchPurpose" TEXT NOT NULL DEFAULT '';

-- Backfill searchPurpose from existing purpose column (lowercase and strip non-alphanumeric)
UPDATE "CatalogItem"
SET "searchPurpose" = LOWER(REGEXP_REPLACE(COALESCE("purpose", ''), '[^a-zA-Z0-9]', '', 'g'))
WHERE "purpose" IS NOT NULL AND "purpose" != '';

-- B-tree index
CREATE INDEX IF NOT EXISTS "CatalogItem_searchPurpose_idx" ON "CatalogItem"("searchPurpose");

-- GIN trigram indexes for fast substring/fuzzy search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "CatalogItem_searchPurpose_trgm_idx"
ON "CatalogItem"
USING gin ("searchPurpose" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CatalogItem_purpose_trgm_idx"
ON "CatalogItem"
USING gin ("purpose" gin_trgm_ops);
