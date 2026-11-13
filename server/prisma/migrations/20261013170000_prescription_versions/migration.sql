-- Corrections void a prescription and add the next version.
DROP INDEX "Prescription_consultationId_key";

ALTER TABLE "Prescription" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "voidedAt" TIMESTAMP(3),
ADD COLUMN "voidReason" TEXT;

CREATE UNIQUE INDEX "Prescription_consultationId_version_key" ON "Prescription"("consultationId", "version");

-- Prisma cannot express this partial index: at most one current (unvoided) prescription per consultation.
CREATE UNIQUE INDEX "Prescription_one_current_per_consultation" ON "Prescription"("consultationId") WHERE "voidedAt" IS NULL;

-- A void must say why.
ALTER TABLE "Prescription" ADD CONSTRAINT "Prescription_void_has_reason" CHECK ("voidedAt" IS NULL OR "voidReason" IS NOT NULL);
