-- Manager correction of Healthians' fasting fields (detailsData is overwritten on every details fetch).
-- Additive and nullable; IF NOT EXISTS because prod was partly built with db push.
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "fastingOverride" TEXT;
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "fastingTimeOverride" TEXT;
