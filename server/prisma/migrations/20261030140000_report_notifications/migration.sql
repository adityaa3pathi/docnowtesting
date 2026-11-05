-- CreateTable
CREATE TABLE "ReportNotification" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SENDING',
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "lastError" TEXT,
    "providerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReportNotification_reportId_channel_key" ON "ReportNotification"("reportId", "channel");

-- AddForeignKey
ALTER TABLE "ReportNotification" ADD CONSTRAINT "ReportNotification_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "Report"("id") ON DELETE CASCADE ON UPDATE CASCADE;

