-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "allergies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "bloodGroup" TEXT,
ADD COLUMN     "chronicConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "currentMedications" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "linkDeclinedAt" TIMESTAMP(3),
ADD COLUMN     "linkedAt" TIMESTAMP(3),
ADD COLUMN     "linkedUserId" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'hi';

-- AlterTable
ALTER TABLE "Consultation" ADD COLUMN     "caregiverJoinedAt" TIMESTAMP(3),
ADD COLUMN     "familyJoinedAt" TIMESTAMP(3),
ADD COLUMN     "guestToken" TEXT,
ADD COLUMN     "isCaregiverJoined" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ConsultationReport" (
    "consultationId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationReport_pkey" PRIMARY KEY ("consultationId","reportId")
);

-- CreateIndex
CREATE INDEX "Patient_phone_idx" ON "Patient"("phone");

-- CreateIndex
CREATE INDEX "Patient_linkedUserId_idx" ON "Patient"("linkedUserId");

-- CreateIndex
CREATE UNIQUE INDEX "Consultation_guestToken_key" ON "Consultation"("guestToken");

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_linkedUserId_fkey" FOREIGN KEY ("linkedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationReport" ADD CONSTRAINT "ConsultationReport_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsultationReport" ADD CONSTRAINT "ConsultationReport_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: consultations still ahead get a guest link too, so family members of existing
-- bookings can join from the web. Past and closed ones stay without one.
UPDATE "Consultation"
SET "guestToken" = gen_random_uuid()::text
WHERE "guestToken" IS NULL AND "status" IN ('CONFIRMED', 'RESCHEDULED', 'WAITING', 'IN_PROGRESS');
