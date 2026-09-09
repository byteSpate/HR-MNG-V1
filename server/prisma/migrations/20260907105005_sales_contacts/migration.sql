-- CreateEnum
CREATE TYPE "SalesContactStatus" AS ENUM ('UNVERIFIED', 'VERIFIED', 'UNREACHABLE', 'INVALID');

-- CreateEnum
CREATE TYPE "SalesChannel" AS ENUM ('CALL', 'EMAIL', 'WHATSAPP', 'OTHER');

-- CreateTable
CREATE TABLE "SalesContact" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "status" "SalesContactStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "verifiedAt" TIMESTAMP(3),
    "verifiedBy" TEXT,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesCommunication" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "contactId" TEXT,
    "channel" "SalesChannel" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" TEXT,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesCommunication_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesContact_salesAccountId_status_idx" ON "SalesContact"("salesAccountId", "status");

-- CreateIndex
CREATE INDEX "SalesCommunication_salesAccountId_occurredAt_idx" ON "SalesCommunication"("salesAccountId", "occurredAt");

-- CreateIndex
CREATE INDEX "SalesCommunication_employeeId_occurredAt_idx" ON "SalesCommunication"("employeeId", "occurredAt");

-- CreateIndex
CREATE INDEX "SalesCommunication_contactId_idx" ON "SalesCommunication"("contactId");

-- AddForeignKey
ALTER TABLE "SalesContact" ADD CONSTRAINT "SalesContact_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCommunication" ADD CONSTRAINT "SalesCommunication_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCommunication" ADD CONSTRAINT "SalesCommunication_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SalesContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesCommunication" ADD CONSTRAINT "SalesCommunication_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
