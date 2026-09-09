-- CreateEnum
CREATE TYPE "SalesAccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'DO_NOT_CONTACT');

-- CreateTable
CREATE TABLE "SalesAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "website" TEXT,
    "address" TEXT,
    "status" "SalesAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAccountAssignment" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "assignedBy" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesAccountAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccount_name_key" ON "SalesAccount"("name");

-- CreateIndex
CREATE INDEX "SalesAccount_ownerEmployeeId_status_idx" ON "SalesAccount"("ownerEmployeeId", "status");

-- CreateIndex
CREATE INDEX "SalesAccount_status_idx" ON "SalesAccount"("status");

-- CreateIndex
CREATE INDEX "SalesAccountAssignment_employeeId_idx" ON "SalesAccountAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountAssignment_salesAccountId_employeeId_key" ON "SalesAccountAssignment"("salesAccountId", "employeeId");

-- AddForeignKey
ALTER TABLE "SalesAccount" ADD CONSTRAINT "SalesAccount_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountAssignment" ADD CONSTRAINT "SalesAccountAssignment_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountAssignment" ADD CONSTRAINT "SalesAccountAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
