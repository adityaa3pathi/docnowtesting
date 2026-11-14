-- These columns were in schema.prisma but never in a migration (added outside migrations on live
-- databases). IF NOT EXISTS keeps this safe where they already exist.
ALTER TABLE "Cart" ADD COLUMN IF NOT EXISTS "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX IF NOT EXISTS "Cart_lastActivityAt_idx" ON "Cart"("lastActivityAt");

ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "featuredOrder" INTEGER;
CREATE INDEX IF NOT EXISTS "CatalogItem_isFeatured_type_featuredOrder_idx" ON "CatalogItem"("isFeatured", "type", "featuredOrder");
