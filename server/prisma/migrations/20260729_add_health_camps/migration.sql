-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_addressId_fkey";

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "campId" TEXT,
ALTER COLUMN "addressId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "dob" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "dob" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Camp" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "pincode" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Camp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampCatalogItem" (
    "id" TEXT NOT NULL,
    "campId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Camp_isActive_startDate_idx" ON "Camp"("isActive", "startDate");

-- CreateIndex
CREATE INDEX "Camp_city_idx" ON "Camp"("city");

-- CreateIndex
CREATE INDEX "CampCatalogItem_campId_idx" ON "CampCatalogItem"("campId");

-- CreateIndex
CREATE INDEX "CampCatalogItem_catalogItemId_idx" ON "CampCatalogItem"("catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "CampCatalogItem_campId_catalogItemId_key" ON "CampCatalogItem"("campId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "Address"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_campId_fkey" FOREIGN KEY ("campId") REFERENCES "Camp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampCatalogItem" ADD CONSTRAINT "CampCatalogItem_campId_fkey" FOREIGN KEY ("campId") REFERENCES "Camp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampCatalogItem" ADD CONSTRAINT "CampCatalogItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "CatalogItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
