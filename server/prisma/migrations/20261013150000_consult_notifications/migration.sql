-- CreateTable
CREATE TABLE "ConsultationNotification" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsultationNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationNotification_consultationId_kind_recipient_key" ON "ConsultationNotification"("consultationId", "kind", "recipient");

-- CreateIndex
CREATE INDEX "ConsultationNotification_status_updatedAt_idx" ON "ConsultationNotification"("status", "updatedAt");

-- AddForeignKey
ALTER TABLE "ConsultationNotification" ADD CONSTRAINT "ConsultationNotification_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
