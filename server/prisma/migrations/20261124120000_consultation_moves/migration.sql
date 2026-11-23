-- Self-serve reschedule: a count per booking, the refund basis, and a row for every move.
ALTER TABLE "Consultation" ADD COLUMN "rescheduleCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Consultation" ADD COLUMN "refundBasisStartsAt" TIMESTAMP(3);

CREATE TYPE "ConsultationMoveKind" AS ENUM ('PATIENT_RESCHEDULE', 'DOCTOR_LATE_RESCHEDULE', 'DOCTOR_LATE_REASSIGN');

CREATE TABLE "ConsultationMove" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "kind" "ConsultationMoveKind" NOT NULL,
    "fromDoctorId" TEXT NOT NULL,
    "fromSlotId" TEXT NOT NULL,
    "fromStartsAt" TIMESTAMP(3) NOT NULL,
    "fromPatientJoinedAt" TIMESTAMP(3),
    "toDoctorId" TEXT NOT NULL,
    "toSlotId" TEXT NOT NULL,
    "toStartsAt" TIMESTAMP(3) NOT NULL,
    "byUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationMove_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ConsultationMove_consultationId_createdAt_idx" ON "ConsultationMove"("consultationId", "createdAt");
CREATE INDEX "ConsultationMove_kind_fromStartsAt_idx" ON "ConsultationMove"("kind", "fromStartsAt");

ALTER TABLE "ConsultationMove" ADD CONSTRAINT "ConsultationMove_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationMove" ADD CONSTRAINT "ConsultationMove_fromDoctorId_fkey" FOREIGN KEY ("fromDoctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsultationMove" ADD CONSTRAINT "ConsultationMove_toDoctorId_fkey" FOREIGN KEY ("toDoctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
