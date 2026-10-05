-- CreateEnum
CREATE TYPE "SalesRemovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REFUSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "SalesCollaboratorRemoval" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" "SalesRemovalStatus" NOT NULL DEFAULT 'PENDING',
    "refusalReason" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesCollaboratorRemoval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesCollaboratorRemoval_status_createdAt_idx" ON "SalesCollaboratorRemoval"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SalesCollaboratorRemoval_salesAccountId_employeeId_idx" ON "SalesCollaboratorRemoval"("salesAccountId", "employeeId");

-- AddForeignKey
ALTER TABLE "SalesCollaboratorRemoval" ADD CONSTRAINT "SalesCollaboratorRemoval_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCollaboratorRemoval" ADD CONSTRAINT "SalesCollaboratorRemoval_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
