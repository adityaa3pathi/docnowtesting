-- DropIndex
DROP INDEX "ConsultationNotification_consultationId_kind_recipient_key";

-- AlterTable
ALTER TABLE "ConsultationNotification" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'whatsapp';

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationNotification_consultationId_kind_recipient_chan_key" ON "ConsultationNotification"("consultationId", "kind", "recipient", "channel");

