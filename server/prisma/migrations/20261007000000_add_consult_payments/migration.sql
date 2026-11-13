-- Migration: Consultation payments (rules, consultations, payments, refunds)
-- Rollback: drop the consultation tables, then ConsultPolicy, then the enums.

CREATE TYPE "ConsultationStatus" AS ENUM ('PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR', 'EXPIRED', 'REFUNDED');
CREATE TYPE "ConsultationType" AS ENUM ('VIDEO', 'AUDIO', 'CHAT');
CREATE TYPE "ConsultPaymentStatus" AS ENUM ('CREATED', 'CAPTURED', 'FAILED');
CREATE TYPE "ConsultRefundStatus" AS ENUM ('PENDING', 'PROCESSED', 'FAILED');
CREATE TYPE "ConsultRefundReason" AS ENUM ('PATIENT_CANCEL', 'DOCTOR_NO_SHOW', 'LATE_PAYMENT_SLOT_LOST', 'PAID_AFTER_CANCEL', 'DUPLICATE_PAYMENT', 'ADMIN', 'EXTERNAL');

CREATE TABLE "ConsultPolicy" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "rules" JSONB NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConsultPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Consultation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "slotId" TEXT NOT NULL,
    "type" "ConsultationType" NOT NULL DEFAULT 'VIDEO',
    "status" "ConsultationStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
    "feePaise" INTEGER NOT NULL,
    "platformFeePaise" INTEGER NOT NULL,
    "policyId" TEXT NOT NULL,
    "policySnapshot" JSONB NOT NULL,
    "holdExpiresAt" TIMESTAMP(3) NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "orderReceipt" TEXT NOT NULL,
    "confirmingPaymentId" TEXT,
    "reviewReason" TEXT,
    "cancelledBy" TEXT,
    "cancelReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Consultation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultationPayment" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "razorpayOrderId" TEXT NOT NULL,
    "razorpayPaymentId" TEXT,
    "amountPaise" INTEGER NOT NULL,
    "status" "ConsultPaymentStatus" NOT NULL DEFAULT 'CREATED',
    "capturedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsultationPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsultationRefund" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "reason" "ConsultRefundReason" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "status" "ConsultRefundStatus" NOT NULL DEFAULT 'PENDING',
    "razorpayRefundId" TEXT,
    "receipt" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConsultationRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConsultPolicy_version_key" ON "ConsultPolicy"("version");
CREATE UNIQUE INDEX "Consultation_orderReceipt_key" ON "Consultation"("orderReceipt");
CREATE UNIQUE INDEX "Consultation_userId_idempotencyKey_key" ON "Consultation"("userId", "idempotencyKey");
CREATE INDEX "Consultation_slotId_idx" ON "Consultation"("slotId");
CREATE INDEX "Consultation_status_holdExpiresAt_idx" ON "Consultation"("status", "holdExpiresAt");
CREATE INDEX "Consultation_userId_createdAt_idx" ON "Consultation"("userId", "createdAt");
CREATE INDEX "Consultation_doctorId_startsAt_idx" ON "Consultation"("doctorId", "startsAt");
CREATE UNIQUE INDEX "ConsultationPayment_razorpayPaymentId_key" ON "ConsultationPayment"("razorpayPaymentId");
CREATE INDEX "ConsultationPayment_razorpayOrderId_idx" ON "ConsultationPayment"("razorpayOrderId");
CREATE INDEX "ConsultationPayment_consultationId_idx" ON "ConsultationPayment"("consultationId");
CREATE UNIQUE INDEX "ConsultationRefund_razorpayRefundId_key" ON "ConsultationRefund"("razorpayRefundId");
CREATE UNIQUE INDEX "ConsultationRefund_receipt_key" ON "ConsultationRefund"("receipt");
CREATE UNIQUE INDEX "ConsultationRefund_paymentId_reason_key" ON "ConsultationRefund"("paymentId", "reason");
CREATE INDEX "ConsultationRefund_status_updatedAt_idx" ON "ConsultationRefund"("status", "updatedAt");

-- Raw SQL: Prisma cannot express these.
-- One active consultation per slot. Allow-list of active statuses, so a status added later is not covered by accident.
CREATE UNIQUE INDEX "Consultation_slotId_active_key" ON "Consultation"("slotId")
    WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS', 'COMPLETED', 'NO_SHOW_PATIENT', 'NO_SHOW_DOCTOR');
-- Exactly one active rules row.
CREATE UNIQUE INDEX "ConsultPolicy_one_active_key" ON "ConsultPolicy"("isActive") WHERE "isActive" = true;
ALTER TABLE "ConsultationRefund" ADD CONSTRAINT "ConsultationRefund_amount_positive" CHECK ("amountPaise" > 0);

ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Consultation" ADD CONSTRAINT "Consultation_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationPayment" ADD CONSTRAINT "ConsultationPayment_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationRefund" ADD CONSTRAINT "ConsultationRefund_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationRefund" ADD CONSTRAINT "ConsultationRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "ConsultationPayment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Default rules so an active row always exists. Mirrors DEFAULT_RULES in consultations.policy.ts.
INSERT INTO "ConsultPolicy" ("id", "version", "isActive", "rules", "reason")
VALUES ('default-consult-policy-v1', 1, true,
  '{"refundTiers":[{"minHoursBefore":24,"percent":100},{"minHoursBefore":6,"percent":50},{"minHoursBefore":0,"percent":0}],"doctorNoShowWaitMinutes":10,"patientNoShowWaitMinutes":10,"doctorNoShowOutcome":"FULL_REFUND","platformFeeBps":1000,"holdMinutes":10,"minLeadMinutes":15,"uploadLimitMb":10}'::jsonb,
  'Initial defaults');
