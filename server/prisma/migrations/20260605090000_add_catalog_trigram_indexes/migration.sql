CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "CatalogItem_searchName_trgm_idx"
ON "CatalogItem"
USING gin ("searchName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "CatalogItem_name_trgm_idx"
ON "CatalogItem"
USING gin ("name" gin_trgm_ops);
