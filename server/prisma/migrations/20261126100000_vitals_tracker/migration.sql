-- CreateTable
CREATE TABLE "VitalReading" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "systolic" INTEGER,
    "diastolic" INTEGER,
    "pulse" INTEGER,
    "glucoseMgDl" INTEGER,
    "sugarTiming" TEXT,
    "measuredAt" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VitalReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "flow" TEXT,
    "symptoms" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PeriodLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VitalReading_patientId_kind_measuredAt_idx" ON "VitalReading"("patientId", "kind", "measuredAt");

-- CreateIndex
CREATE INDEX "VitalReading_userId_idx" ON "VitalReading"("userId");

-- CreateIndex
CREATE INDEX "PeriodLog_userId_idx" ON "PeriodLog"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodLog_patientId_startDate_key" ON "PeriodLog"("patientId", "startDate");

-- AddForeignKey
ALTER TABLE "VitalReading" ADD CONSTRAINT "VitalReading_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VitalReading" ADD CONSTRAINT "VitalReading_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLog" ADD CONSTRAINT "PeriodLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodLog" ADD CONSTRAINT "PeriodLog_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backstop for the app's checks: a reading has the values of its kind, inside what is physically
-- possible (not a "normal" range). Every value is tested IS NOT NULL: a CHECK that is NULL passes. Prisma does not model CHECK constraints; keep these in raw SQL.
ALTER TABLE "VitalReading" ADD CONSTRAINT "VitalReading_values_check" CHECK (
    ("kind" = 'BP' AND "systolic" IS NOT NULL AND "diastolic" IS NOT NULL AND "systolic" BETWEEN 50 AND 300 AND "diastolic" BETWEEN 30 AND 200 AND "systolic" > "diastolic"
        AND ("pulse" IS NULL OR "pulse" BETWEEN 25 AND 250) AND "glucoseMgDl" IS NULL AND "sugarTiming" IS NULL)
    OR ("kind" = 'SUGAR' AND "glucoseMgDl" IS NOT NULL AND "sugarTiming" IS NOT NULL AND "glucoseMgDl" BETWEEN 20 AND 1000 AND "sugarTiming" IN ('FASTING', 'BEFORE_MEAL', 'AFTER_MEAL', 'RANDOM')
        AND "systolic" IS NULL AND "diastolic" IS NULL AND "pulse" IS NULL)
);
ALTER TABLE "PeriodLog" ADD CONSTRAINT "PeriodLog_dates_check" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
