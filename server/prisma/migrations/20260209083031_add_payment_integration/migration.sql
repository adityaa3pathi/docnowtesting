/*
  Warnings:

  - The `paymentStatus` column on the `Booking` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - A unique constraint covering the columns `[razorpayOrderId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[razorpayPaymentId]` on the table `Booking` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('INITIATED', 'AUTHORIZED', 'CONFIRMED', 'PARTNER_FAILED', 'FAILED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "partnerError" TEXT,
ADD COLUMN     "razorpayPaymentId" TEXT,
DROP COLUMN "paymentStatus",
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'INITIATED';

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "eventId" TEXT NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateIndex
CREATE INDEX "WebhookEvent_createdAt_idx" ON "WebhookEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_razorpayOrderId_key" ON "Booking"("razorpayOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Booking_razorpayPaymentId_key" ON "Booking"("razorpayPaymentId");
