-- CreateEnum
CREATE TYPE "InstantRequestStatus" AS ENUM ('SEARCHING', 'RINGING', 'ACCEPTED', 'BOOKED', 'CANCELLED', 'NO_MATCH', 'UNPAID');
-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "isInstant" BOOLEAN NOT NULL DEFAULT false;
-- CreateTable
CREATE TABLE "DoctorPresence" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "missedRings" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "DoctorPresence_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "InstantRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "shareRecord" BOOLEAN NOT NULL DEFAULT false,
    "status" "InstantRequestStatus" NOT NULL DEFAULT 'SEARCHING',
    "searchEndsAt" TIMESTAMP(3) NOT NULL,
    "doctorId" TEXT,
    "ringExpiresAt" TIMESTAMP(3),
    "rings" INTEGER NOT NULL DEFAULT 0,
    "triedDoctorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blockedSlotIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "acceptedAt" TIMESTAMP(3),
    "payBy" TIMESTAMP(3),
    "slotId" TEXT,
    "consultationId" TEXT,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "InstantRequest_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "DoctorPresence_doctorId_startedAt_idx" ON "DoctorPresence"("doctorId", "startedAt");
-- CreateIndex
CREATE INDEX "DoctorPresence_endedAt_lastSeenAt_idx" ON "DoctorPresence"("endedAt", "lastSeenAt");
-- CreateIndex
CREATE UNIQUE INDEX "InstantRequest_slotId_key" ON "InstantRequest"("slotId");
-- CreateIndex
CREATE UNIQUE INDEX "InstantRequest_consultationId_key" ON "InstantRequest"("consultationId");
-- CreateIndex
CREATE INDEX "InstantRequest_status_createdAt_idx" ON "InstantRequest"("status", "createdAt");
-- CreateIndex
CREATE INDEX "InstantRequest_userId_createdAt_idx" ON "InstantRequest"("userId", "createdAt");
-- AddForeignKey
ALTER TABLE "DoctorPresence" ADD CONSTRAINT "DoctorPresence_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InstantRequest" ADD CONSTRAINT "InstantRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InstantRequest" ADD CONSTRAINT "InstantRequest_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InstantRequest" ADD CONSTRAINT "InstantRequest_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InstantRequest" ADD CONSTRAINT "InstantRequest_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "Slot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "InstantRequest" ADD CONSTRAINT "InstantRequest_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique indexes (Prisma cannot express these; keep them in any later generated migration).
-- One open online period per doctor.
CREATE UNIQUE INDEX "DoctorPresence_one_open_per_doctor" ON "DoctorPresence"("doctorId") WHERE "endedAt" IS NULL;
-- One live instant request per account.
CREATE UNIQUE INDEX "InstantRequest_one_live_per_user" ON "InstantRequest"("userId") WHERE "status" IN ('SEARCHING', 'RINGING', 'ACCEPTED');
-- A doctor is rung for, or holds, at most one request at a time: two patients can never get the same doctor.
CREATE UNIQUE INDEX "InstantRequest_one_live_per_doctor" ON "InstantRequest"("doctorId") WHERE "status" IN ('RINGING', 'ACCEPTED');
