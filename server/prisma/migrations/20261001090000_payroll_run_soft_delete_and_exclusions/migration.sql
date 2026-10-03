-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN "deletedAt" TIMESTAMP(3),
ADD COLUMN "deletedBy" TEXT,
ADD COLUMN "activeKey" TEXT,
ADD COLUMN "excludedEmployeeIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Every run that exists today is live, so each one takes its month as its key.
UPDATE "PayrollRun" SET "activeKey" = "year"::text || '-' || lpad("month"::text, 2, '0');

-- The old rule, one run per month, becomes one LIVE run per month.
DROP INDEX "PayrollRun_month_year_key";

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_activeKey_key" ON "PayrollRun"("activeKey");

-- CreateIndex
CREATE INDEX "PayrollRun_month_year_idx" ON "PayrollRun"("month", "year");
