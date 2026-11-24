-- CreateEnum
CREATE TYPE "ConsultationChatRole" AS ENUM ('DOCTOR', 'PATIENT', 'CARETAKER');

-- CreateTable
CREATE TABLE "ConsultationMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "consultationId" TEXT NOT NULL,
    "senderRole" "ConsultationChatRole" NOT NULL,
    "senderIdentity" TEXT NOT NULL,
    "body" VARCHAR(1000) NOT NULL,
    "clientId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsultationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationMessage_seq_key" ON "ConsultationMessage"("seq");

-- CreateIndex
CREATE INDEX "ConsultationMessage_consultationId_seq_idx" ON "ConsultationMessage"("consultationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "ConsultationMessage_consultationId_senderIdentity_clientId_key" ON "ConsultationMessage"("consultationId", "senderIdentity", "clientId");

-- AddForeignKey
ALTER TABLE "ConsultationMessage" ADD CONSTRAINT "ConsultationMessage_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
