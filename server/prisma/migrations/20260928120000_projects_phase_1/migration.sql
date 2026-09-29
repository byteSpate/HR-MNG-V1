-- CreateEnum
CREATE TYPE "VatMethod" AS ENUM ('CODE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'BLOCKED', 'ON_HOLD', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "CustomerPoLine" ADD COLUMN     "vatMethod" "VatMethod" NOT NULL DEFAULT 'CODE',
ADD COLUMN     "vatRatePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "vatMethod" "VatMethod" NOT NULL DEFAULT 'CODE',
ADD COLUMN     "vatRatePercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "SupplierBillLine" ADD COLUMN     "vatMethod" "VatMethod" NOT NULL DEFAULT 'CODE',
ADD COLUMN     "vatRatePercent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "managerEmployeeId" TEXT NOT NULL,
    "startOn" TIMESTAMP(3),
    "dueOn" TIMESTAMP(3),
    "priority" "SalesTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "budget" DECIMAL(14,2),
    "status" "ProjectStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "statusReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTeamMember" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "responsibility" TEXT,

    CONSTRAINT "ProjectTeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMilestone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueOn" TIMESTAMP(3),
    "doneAt" TIMESTAMP(3),
    "doneBy" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ProjectMilestone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectLineDone" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "opportunityLineId" TEXT NOT NULL,
    "doneBy" TEXT NOT NULL,
    "doneAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectLineDone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OpportunityDocumentLink" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "stage" "OpportunityStage" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OpportunityDocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_serial_key" ON "Project"("serial");

-- CreateIndex
CREATE UNIQUE INDEX "Project_opportunityId_key" ON "Project"("opportunityId");

-- CreateIndex
CREATE INDEX "Project_salesAccountId_idx" ON "Project"("salesAccountId");

-- CreateIndex
CREATE INDEX "Project_managerEmployeeId_status_idx" ON "Project"("managerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "Project_status_idx" ON "Project"("status");

-- CreateIndex
CREATE INDEX "ProjectTeamMember_employeeId_idx" ON "ProjectTeamMember"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTeamMember_projectId_employeeId_key" ON "ProjectTeamMember"("projectId", "employeeId");

-- CreateIndex
CREATE INDEX "ProjectMilestone_projectId_order_idx" ON "ProjectMilestone"("projectId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectLineDone_projectId_opportunityLineId_key" ON "ProjectLineDone"("projectId", "opportunityLineId");

-- CreateIndex
CREATE INDEX "OpportunityDocumentLink_opportunityId_createdAt_idx" ON "OpportunityDocumentLink"("opportunityId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_managerEmployeeId_fkey" FOREIGN KEY ("managerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeamMember" ADD CONSTRAINT "ProjectTeamMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTeamMember" ADD CONSTRAINT "ProjectTeamMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMilestone" ADD CONSTRAINT "ProjectMilestone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLineDone" ADD CONSTRAINT "ProjectLineDone_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectLineDone" ADD CONSTRAINT "ProjectLineDone_opportunityLineId_fkey" FOREIGN KEY ("opportunityLineId") REFERENCES "OpportunityLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityDocumentLink" ADD CONSTRAINT "OpportunityDocumentLink_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing line used its VAT code's rate. Save that rate on the line.
UPDATE "CustomerPoLine" l SET "vatRatePercent" = v."ratePercent" FROM "VatCode" v WHERE v."id" = l."vatCodeId" AND l."vatRatePercent" IS NULL;
UPDATE "InvoiceLine" l SET "vatRatePercent" = v."ratePercent" FROM "VatCode" v WHERE v."id" = l."vatCodeId" AND l."vatRatePercent" IS NULL;
UPDATE "SupplierBillLine" l SET "vatRatePercent" = v."ratePercent" FROM "VatCode" v WHERE v."id" = l."vatCodeId" AND l."vatRatePercent" IS NULL;
