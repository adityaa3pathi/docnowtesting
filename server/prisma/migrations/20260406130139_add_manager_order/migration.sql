-- CreateEnum
CREATE TYPE "ManagerOrderStatus" AS ENUM ('CREATED', 'SENT', 'PAYMENT_RECEIVED', 'PAYMENT_CONFIRMED', 'CONFIRMED', 'BOOKING_FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CollectionMode" AS ENUM ('RAZORPAY_LINK', 'OFFLINE_CASH', 'OFFLINE_UPI');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'PROCESSING';

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "createdByManagerId" TEXT,
ADD COLUMN     "processingAttemptId" TEXT,
ADD COLUMN     "processingStartedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ManagerOrder" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "status" "ManagerOrderStatus" NOT NULL DEFAULT 'CREATED',
    "collectionMode" "CollectionMode",
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "razorpayLinkId" TEXT,
    "razorpayLinkUrl" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManagerOrder_bookingId_key" ON "ManagerOrder"("bookingId");

-- CreateIndex
CREATE INDEX "ManagerOrder_managerId_status_idx" ON "ManagerOrder"("managerId", "status");

-- CreateIndex
CREATE INDEX "ManagerOrder_customerId_idx" ON "ManagerOrder"("customerId");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_createdByManagerId_fkey" FOREIGN KEY ("createdByManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerOrder" ADD CONSTRAINT "ManagerOrder_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerOrder" ADD CONSTRAINT "ManagerOrder_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManagerOrder" ADD CONSTRAINT "ManagerOrder_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
