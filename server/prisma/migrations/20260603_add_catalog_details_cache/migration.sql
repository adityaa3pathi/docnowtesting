ALTER TABLE "CatalogItem"
ADD COLUMN "detailsData" JSONB,
ADD COLUMN "detailsFetchedAt" TIMESTAMP(3),
ADD COLUMN "detailsFetchStatus" TEXT,
ADD COLUMN "detailsFetchError" TEXT;
