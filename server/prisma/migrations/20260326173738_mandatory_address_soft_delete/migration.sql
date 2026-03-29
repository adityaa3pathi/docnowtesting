/*
  Warnings:

  - A unique constraint covering the columns `[idempotencyKey]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[bookingId,reportUrl]` on the table `Report` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[referenceType,referenceId]` on the table `WalletLedger` will be added. If there are existing duplicate values, this will fail.
  - Made the column `addressId` on table `Booking` required. This step will fail if there are existing NULL values in that column.

*/
-- CreateEnum
CREATE TYPE "CatalogItemType" AS ENUM ('TEST', 'PACKAGE', 'PROFILE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'MANAGER';

-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_addressId_fkey";

-- DropIndex
DROP INDEX "WalletLedger_referenceType_referenceId_idx";

-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "billingGender" TEXT,
ADD COLUMN     "billingName" TEXT,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "partnerStatus" TEXT,
ADD COLUMN     "phleboName" TEXT,
ADD COLUMN     "phleboPhone" TEXT,
ADD COLUMN     "phleboTrackingUrl" TEXT,
ALTER COLUMN "addressId" SET NOT NULL;

-- AlterTable
ALTER TABLE "PromoCode" ADD COLUMN     "maxPerUser" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Report" ADD COLUMN     "isFullReport" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "storedUrl" TEXT,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WebhookEventV2" (
    "id" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "eventType" TEXT,
    "bookingId" TEXT,
    "rawPayload" JSONB,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventV2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartnerRetry" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartnerRetry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItem" (
    "id" TEXT NOT NULL,
    "partnerCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CatalogItemType" NOT NULL DEFAULT 'TEST',
    "partnerPrice" DOUBLE PRECISION NOT NULL,
    "displayPrice" DOUBLE PRECISION NOT NULL,
    "discountedPrice" DOUBLE PRECISION,
    "description" TEXT,
    "parameters" TEXT,
    "sampleType" TEXT,
    "reportTime" TEXT,
    "partnerData" JSONB,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CatalogItemCategory" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CatalogItemCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEventV2_payloadHash_key" ON "WebhookEventV2"("payloadHash");

-- CreateIndex
CREATE INDEX "WebhookEventV2_source_createdAt_idx" ON "WebhookEventV2"("source", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookEventV2_bookingId_idx" ON "WebhookEventV2"("bookingId");

-- CreateIndex
CREATE INDEX "WebhookEventV2_processed_createdAt_idx" ON "WebhookEventV2"("processed", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PartnerRetry_bookingId_key" ON "PartnerRetry"("bookingId");

-- CreateIndex
CREATE INDEX "PartnerRetry_nextRetryAt_attempts_idx" ON "PartnerRetry"("nextRetryAt", "attempts");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItem_partnerCode_key" ON "CatalogItem"("partnerCode");

-- CreateIndex
CREATE INDEX "CatalogItem_isEnabled_idx" ON "CatalogItem"("isEnabled");

-- CreateIndex
CREATE INDEX "CatalogItem_type_isEnabled_idx" ON "CatalogItem"("type", "isEnabled");

-- CreateIndex
CREATE UNIQUE INDEX "Category_name_key" ON "Category"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Category_slug_key" ON "Category"("slug");

-- CreateIndex
CREATE INDEX "Category_isActive_sortOrder_idx" ON "Category"("isActive", "sortOrder");

-- CreateIndex
CREATE INDEX "CatalogItemCategory_categoryId_sortOrder_idx" ON "CatalogItemCategory"("categoryId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CatalogItemCategory_catalogItemId_categoryId_key" ON "CatalogItemCategory"("catalogItemId", "categoryId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_idempotencyKey_key" ON "Booking"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Booking_paymentStatus_updatedAt_idx" ON "Booking"("paymentStatus", "updatedAt");

-- CreateIndex
CREATE INDEX "Booking_userId_paymentStatus_idx" ON "Booking"("userId", "paymentStatus");

-- CreateIndex
CREATE INDEX "Booking_partnerStatus_idx" ON "Booking"("partnerStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Report_bookingId_reportUrl_key" ON "Report"("bookingId", "reportUrl");

-- CreateIndex
CREATE UNIQUE INDEX "WalletLedger_referenceType_referenceId_key" ON "WalletLedger"("referenceType", "referenceId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartnerRetry" ADD CONSTRAINT "PartnerRetry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemCategory" ADD CONSTRAINT "CatalogItemCategory_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CatalogItemCategory" ADD CONSTRAINT "CatalogItemCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;
