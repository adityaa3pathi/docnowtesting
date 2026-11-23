-- Doctor changes to weekly hours and profile text wait for super-admin approval.
CREATE TYPE "DoctorChangeKind" AS ENUM ('AVAILABILITY', 'PROFILE');
CREATE TYPE "DoctorChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');

CREATE TABLE "DoctorChangeRequest" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "kind" "DoctorChangeKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "previous" JSONB NOT NULL,
    "status" "DoctorChangeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewReason" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DoctorChangeRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DoctorChangeRequest_status_createdAt_idx" ON "DoctorChangeRequest"("status", "createdAt");
CREATE INDEX "DoctorChangeRequest_doctorId_createdAt_idx" ON "DoctorChangeRequest"("doctorId", "createdAt");

ALTER TABLE "DoctorChangeRequest" ADD CONSTRAINT "DoctorChangeRequest_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "DoctorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Raw SQL (Prisma cannot express it): one pending request per doctor and kind. Keep it in later migrations.
CREATE UNIQUE INDEX "DoctorChangeRequest_one_pending_key" ON "DoctorChangeRequest"("doctorId", "kind") WHERE "status" = 'PENDING';
