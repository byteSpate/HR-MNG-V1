-- AlterEnum
ALTER TYPE "SalesTrack" ADD VALUE 'SOFTWARE_DEVELOPMENT';

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN     "customerId" TEXT,
ADD COLUMN     "opportunityId" TEXT,
ADD COLUMN     "supplierId" TEXT;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT,
    "legalName" TEXT NOT NULL,
    "billingAddress" TEXT,
    "bin" TEXT,
    "paymentDays" INTEGER NOT NULL DEFAULT 30,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "bin" TEXT,
    "paymentDays" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOpeningBalance" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOpeningBalance" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,
    "importedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOpeningBalance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Customer_salesAccountId_key" ON "Customer"("salesAccountId");

-- CreateIndex
CREATE INDEX "Customer_legalName_idx" ON "Customer"("legalName");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_name_key" ON "Supplier"("name");

-- CreateIndex
CREATE INDEX "Supplier_name_idx" ON "Supplier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerOpeningBalance_customerId_key" ON "CustomerOpeningBalance"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SupplierOpeningBalance_supplierId_key" ON "SupplierOpeningBalance"("supplierId");

-- CreateIndex
CREATE INDEX "JournalLine_opportunityId_idx" ON "JournalLine"("opportunityId");

-- CreateIndex
CREATE INDEX "JournalLine_customerId_idx" ON "JournalLine"("customerId");

-- CreateIndex
CREATE INDEX "JournalLine_supplierId_idx" ON "JournalLine"("supplierId");

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOpeningBalance" ADD CONSTRAINT "CustomerOpeningBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOpeningBalance" ADD CONSTRAINT "SupplierOpeningBalance_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
