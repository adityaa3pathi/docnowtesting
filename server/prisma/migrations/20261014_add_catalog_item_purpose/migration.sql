-- Manager-written "What it's for" text; IF NOT EXISTS because prod was partly built with db push
ALTER TABLE "CatalogItem" ADD COLUMN IF NOT EXISTS "purpose" TEXT;
