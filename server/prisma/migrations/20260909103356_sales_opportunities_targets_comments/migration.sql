-- CreateEnum
CREATE TYPE "SalesTrack" AS ENUM ('NETWORKING');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('ONGOING', 'WON', 'LOST', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OpportunityStage" AS ENUM ('REQUIREMENT_RECEIVED', 'SOLUTION_DESIGN', 'OEM_PRICING', 'QUOTATION_SUBMITTED', 'NEGOTIATION', 'AWAITING_DECISION');

-- CreateEnum
CREATE TYPE "SalesCommentKind" AS ENUM ('GENERAL', 'CUSTOMER_FEEDBACK', 'MANAGEMENT_NOTE');

-- DropTable
DROP TABLE "Report";

-- CreateTable
CREATE TABLE "Opportunity" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "meetingId" TEXT,
    "track" "SalesTrack" NOT NULL DEFAULT 'NETWORKING',
    "name" TEXT NOT NULL,
    "oemAccountManager" TEXT,
    "amount" DECIMAL(14,2),
    "currency" "Currency" NOT NULL DEFAULT 'BDT',
    "expectedCloseDate" TIMESTAMP(3),
    "status" "OpportunityStatus" NOT NULL DEFAULT 'ONGOING',
    "statusReason" TEXT,
    "closedAt" TIMESTAMP(3),
    "stage" "OpportunityStage" NOT NULL DEFAULT 'REQUIREMENT_RECEIVED',
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextStep" TEXT,
    "nextStepDueOn" TIMESTAMP(3),
    "ownerEmployeeId" TEXT NOT NULL,
    "wonByEmployeeId" TEXT,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Opportunity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityLine" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "oemBrand" TEXT,
    "model" TEXT,
    "quantity" INTEGER,
    "unitValue" DECIMAL(14,2),
    "lineValue" DECIMAL(14,2),
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesComment" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" "SalesCommentKind" NOT NULL,
    "body" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "funnelMeetingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTarget" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "calendarYear" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "targetDeals" INTEGER NOT NULL,
    "note" TEXT,
    "setBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Opportunity_serial_key" ON "Opportunity"("serial");

-- CreateIndex
CREATE INDEX "Opportunity_salesAccountId_idx" ON "Opportunity"("salesAccountId");

-- CreateIndex
CREATE INDEX "Opportunity_status_expectedCloseDate_idx" ON "Opportunity"("status", "expectedCloseDate");

-- CreateIndex
CREATE INDEX "Opportunity_ownerEmployeeId_status_idx" ON "Opportunity"("ownerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "Opportunity_status_lastActivityAt_idx" ON "Opportunity"("status", "lastActivityAt");

-- CreateIndex
CREATE INDEX "Opportunity_status_stage_idx" ON "Opportunity"("status", "stage");

-- CreateIndex
CREATE INDEX "Opportunity_wonByEmployeeId_closedAt_idx" ON "Opportunity"("wonByEmployeeId", "closedAt");

-- CreateIndex
CREATE INDEX "OpportunityLine_opportunityId_order_idx" ON "OpportunityLine"("opportunityId", "order");

-- CreateIndex
CREATE INDEX "SalesComment_entity_entityId_createdAt_idx" ON "SalesComment"("entity", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesComment_funnelMeetingId_createdAt_idx" ON "SalesComment"("funnelMeetingId", "createdAt");

-- CreateIndex
CREATE INDEX "SalesTarget_calendarYear_quarter_idx" ON "SalesTarget"("calendarYear", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTarget_employeeId_calendarYear_quarter_key" ON "SalesTarget"("employeeId", "calendarYear", "quarter");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_wonByEmployeeId_fkey" FOREIGN KEY ("wonByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLine" ADD CONSTRAINT "OpportunityLine_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesComment" ADD CONSTRAINT "SalesComment_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTarget" ADD CONSTRAINT "SalesTarget_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
