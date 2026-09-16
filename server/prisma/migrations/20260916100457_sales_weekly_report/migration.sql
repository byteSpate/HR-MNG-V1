-- CreateEnum
CREATE TYPE "WeeklyReportStatus" AS ENUM ('DRAFT', 'SUBMITTED');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "softwareNeeded" BOOLEAN;

-- CreateTable
CREATE TABLE "WeeklyReport" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "status" "WeeklyReportStatus" NOT NULL DEFAULT 'DRAFT',
    "firstSubmittedAt" TIMESTAMP(3),
    "submittedLate" BOOLEAN NOT NULL DEFAULT false,
    "lastSubmittedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyReportCopy" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedBy" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,

    CONSTRAINT "WeeklyReportCopy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyAccountNote" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "challenges" TEXT,
    "gap" TEXT,
    "nextStep" TEXT,
    "taskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyAccountNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyOtherWork" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyOtherWork_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyReport_weekStart_status_idx" ON "WeeklyReport"("weekStart", "status");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyReport_employeeId_weekStart_key" ON "WeeklyReport"("employeeId", "weekStart");

-- CreateIndex
CREATE INDEX "WeeklyReportCopy_weeklyReportId_submittedAt_idx" ON "WeeklyReportCopy"("weeklyReportId", "submittedAt");

-- CreateIndex
CREATE INDEX "WeeklyAccountNote_salesAccountId_date_idx" ON "WeeklyAccountNote"("salesAccountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyAccountNote_weeklyReportId_date_salesAccountId_key" ON "WeeklyAccountNote"("weeklyReportId", "date", "salesAccountId");

-- CreateIndex
CREATE INDEX "WeeklyOtherWork_weeklyReportId_date_idx" ON "WeeklyOtherWork"("weeklyReportId", "date");

-- AddForeignKey
ALTER TABLE "WeeklyReport" ADD CONSTRAINT "WeeklyReport_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyReportCopy" ADD CONSTRAINT "WeeklyReportCopy_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAccountNote" ADD CONSTRAINT "WeeklyAccountNote_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyAccountNote" ADD CONSTRAINT "WeeklyAccountNote_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyOtherWork" ADD CONSTRAINT "WeeklyOtherWork_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
