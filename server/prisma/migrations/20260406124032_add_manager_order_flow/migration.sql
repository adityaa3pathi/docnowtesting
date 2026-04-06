/*
  Warnings:

  - You are about to drop the column `reportUrl` on the `Report` table. All the data in the column will be lost.
  - You are about to drop the column `storedUrl` on the `Report` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[bookingId,vendorCustomerId,isFullReport,verifiedAt]` on the table `Report` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `sourceUrl` to the `Report` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "Report_bookingId_reportUrl_key";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "addressCity" TEXT,
ADD COLUMN     "addressLat" TEXT,
ADD COLUMN     "addressLine" TEXT,
ADD COLUMN     "addressLong" TEXT,
ADD COLUMN     "addressPincode" TEXT,
ADD COLUMN     "partnerSlotId" TEXT;

-- AlterTable
ALTER TABLE "Report" DROP COLUMN "reportUrl",
DROP COLUMN "storedUrl",
ADD COLUMN     "fetchError" TEXT,
ADD COLUMN     "fetchStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "fetchedAt" TIMESTAMP(3),
ADD COLUMN     "fileSize" INTEGER,
ADD COLUMN     "sourceUrl" TEXT NOT NULL,
ADD COLUMN     "storageKey" TEXT,
ADD COLUMN     "vendorCustomerId" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "Report_bookingId_vendorCustomerId_isFullReport_verifiedAt_key" ON "Report"("bookingId", "vendorCustomerId", "isFullReport", "verifiedAt");
