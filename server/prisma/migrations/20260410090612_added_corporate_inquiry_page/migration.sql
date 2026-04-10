-- CreateEnum
CREATE TYPE "CorporateInquiryStatus" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED');

-- CreateTable
CREATE TABLE "CorporateInquiry" (
    "id" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "workEmail" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "companySize" TEXT NOT NULL,
    "requirementType" TEXT NOT NULL,
    "summary" TEXT,
    "status" "CorporateInquiryStatus" NOT NULL DEFAULT 'NEW',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateInquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CorporateInquiry_status_createdAt_idx" ON "CorporateInquiry"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CorporateInquiry_city_idx" ON "CorporateInquiry"("city");

-- CreateIndex
CREATE INDEX "CorporateInquiry_requirementType_idx" ON "CorporateInquiry"("requirementType");

-- CreateIndex
CREATE INDEX "CorporateInquiry_companyName_idx" ON "CorporateInquiry"("companyName");
