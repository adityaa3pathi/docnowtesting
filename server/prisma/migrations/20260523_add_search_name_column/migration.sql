-- AlterTable
ALTER TABLE "CatalogItem" ADD COLUMN "searchName" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "CatalogItem_searchName_idx" ON "CatalogItem"("searchName");
