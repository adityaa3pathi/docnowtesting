-- Columns and indexes that schema.prisma declares but no migration creates, so a database built
-- from prisma/migrations alone cannot serve them. Added here only so the test database matches
-- Prisma Client; the missing migrations are a real gap in prisma/migrations.
ALTER TABLE "Cart" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Cart_lastActivityAt_idx" ON "Cart"("lastActivityAt");

ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "featuredOrder" INTEGER;
CREATE INDEX IF NOT EXISTS "CatalogItem_isFeatured_type_featuredOrder_idx" ON "CatalogItem"("isFeatured", "type", "featuredOrder");
