-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OpportunityStage" ADD VALUE 'REQUIREMENT_GATHERING';
ALTER TYPE "OpportunityStage" ADD VALUE 'BRD_SENT';
ALTER TYPE "OpportunityStage" ADD VALUE 'SRS_SENT';
ALTER TYPE "OpportunityStage" ADD VALUE 'PROPOSAL_SUBMITTED';
ALTER TYPE "OpportunityStage" ADD VALUE 'PROPOSAL_REVISION';

-- AlterEnum
ALTER TYPE "SalesTaskOrigin" ADD VALUE 'PROJECT';

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "handedOverFromId" TEXT;

-- CreateTable
CREATE TABLE "ProjectDailyLog" (
    "id" TEXT NOT NULL,
    "weeklyReportId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "noWork" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectDailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectDailyLog_projectId_date_idx" ON "ProjectDailyLog"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectDailyLog_weeklyReportId_projectId_date_key" ON "ProjectDailyLog"("weeklyReportId", "projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_handedOverFromId_key" ON "Opportunity"("handedOverFromId");

-- CreateIndex
CREATE INDEX "SalesTask_projectId_status_idx" ON "SalesTask"("projectId", "status");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_handedOverFromId_fkey" FOREIGN KEY ("handedOverFromId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDailyLog" ADD CONSTRAINT "ProjectDailyLog_weeklyReportId_fkey" FOREIGN KEY ("weeklyReportId") REFERENCES "WeeklyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectDailyLog" ADD CONSTRAINT "ProjectDailyLog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
