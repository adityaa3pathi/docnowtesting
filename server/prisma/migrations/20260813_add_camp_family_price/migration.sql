-- AlterTable
ALTER TABLE "Camp" ADD COLUMN "familyPrice" DOUBLE PRECISION;

-- Backfill: default familyPrice to same as price for existing camps
UPDATE "Camp" SET "familyPrice" = "price" WHERE "familyPrice" IS NULL;

-- Now make it NOT NULL (matches schema: Float without ?)
ALTER TABLE "Camp" ALTER COLUMN "familyPrice" SET NOT NULL;
