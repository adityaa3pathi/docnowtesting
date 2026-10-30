-- AlterTable
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ConsultationConsent" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "userId" TEXT,
    "channel" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationConsent_consultationId_identity_key" ON "ConsultationConsent"("consultationId", "identity");

-- AddForeignKey
ALTER TABLE "ConsultationConsent" ADD CONSTRAINT "ConsultationConsent_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
