-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('VISIBLE', 'HIDDEN', 'DELETED');

-- CreateTable
CREATE TABLE "DoctorReview" (
    "id" TEXT NOT NULL,
    "consultationId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'VISIBLE',
    "redactedAt" TIMESTAMP(3),
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppReview" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'VISIBLE',
    "redactedAt" TIMESTAMP(3),
    "replyText" TEXT,
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DoctorReview_consultationId_key" ON "DoctorReview"("consultationId");

-- CreateIndex
CREATE INDEX "DoctorReview_doctorId_status_createdAt_idx" ON "DoctorReview"("doctorId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DoctorReview_status_createdAt_idx" ON "DoctorReview"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AppReview_userId_key" ON "AppReview"("userId");

-- CreateIndex
CREATE INDEX "AppReview_status_createdAt_idx" ON "AppReview"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_consultationId_fkey" FOREIGN KEY ("consultationId") REFERENCES "Consultation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Ratings are whole stars, 1 to 5 (Prisma cannot express CHECK constraints).
ALTER TABLE "DoctorReview" ADD CONSTRAINT "DoctorReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "AppReview" ADD CONSTRAINT "AppReview_rating_check" CHECK ("rating" BETWEEN 1 AND 5);
