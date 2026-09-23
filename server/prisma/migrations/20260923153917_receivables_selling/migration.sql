-- CreateEnum
CREATE TYPE "CustomerPoStatus" AS ENUM ('OPEN', 'COMPLETE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SaleLineKind" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "ReceivableDocStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "CustomerPo" (
    "id" TEXT NOT NULL,
    "serial" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "customerPoNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "invoiceTo" TEXT,
    "status" "CustomerPoStatus" NOT NULL DEFAULT 'OPEN',
    "cancelReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerPo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerPoLine" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "SaleLineKind" NOT NULL,
    "quantity" DECIMAL(14,2) NOT NULL,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatCodeId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "CustomerPoLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingScheduleRow" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "plannedDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "BillingScheduleRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ReceivableDocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatCodeId" TEXT NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Receipt" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vdsAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "vdsCertificateRef" TEXT,
    "vdsCertificateDate" TIMESTAMP(3),
    "aitAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "aitCertificateRef" TEXT,
    "aitCertificateDate" TIMESTAMP(3),
    "reference" TEXT,
    "status" "ReceivableDocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceiptOpeningAllocation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "openingBalanceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceiptOpeningAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditNote" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReceivableDocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerCreditNoteLine" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "invoiceLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "CustomerCreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierOpeningAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "openingBalanceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "matchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierOpeningAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPo_serial_key" ON "CustomerPo"("serial");

-- CreateIndex
CREATE INDEX "CustomerPo_opportunityId_idx" ON "CustomerPo"("opportunityId");

-- CreateIndex
CREATE INDEX "CustomerPo_status_idx" ON "CustomerPo"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerPo_customerId_customerPoNumber_key" ON "CustomerPo"("customerId", "customerPoNumber");

-- CreateIndex
CREATE INDEX "CustomerPoLine_poId_order_idx" ON "CustomerPoLine"("poId", "order");

-- CreateIndex
CREATE INDEX "BillingScheduleRow_poId_order_idx" ON "BillingScheduleRow"("poId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_customerId_status_idx" ON "Invoice"("customerId", "status");

-- CreateIndex
CREATE INDEX "Invoice_poId_idx" ON "Invoice"("poId");

-- CreateIndex
CREATE INDEX "InvoiceLine_invoiceId_idx" ON "InvoiceLine"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLine_poLineId_idx" ON "InvoiceLine"("poLineId");

-- CreateIndex
CREATE INDEX "Receipt_customerId_idx" ON "Receipt"("customerId");

-- CreateIndex
CREATE INDEX "Receipt_status_idx" ON "Receipt"("status");

-- CreateIndex
CREATE INDEX "ReceiptAllocation_invoiceId_idx" ON "ReceiptAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "ReceiptOpeningAllocation_openingBalanceId_idx" ON "ReceiptOpeningAllocation"("openingBalanceId");

-- CreateIndex
CREATE INDEX "CustomerCreditNote_invoiceId_idx" ON "CustomerCreditNote"("invoiceId");

-- CreateIndex
CREATE INDEX "SupplierOpeningAllocation_openingBalanceId_idx" ON "SupplierOpeningAllocation"("openingBalanceId");

-- AddForeignKey
ALTER TABLE "CustomerPo" ADD CONSTRAINT "CustomerPo_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPo" ADD CONSTRAINT "CustomerPo_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPoLine" ADD CONSTRAINT "CustomerPoLine_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerPoLine" ADD CONSTRAINT "CustomerPoLine_vatCodeId_fkey" FOREIGN KEY ("vatCodeId") REFERENCES "VatCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingScheduleRow" ADD CONSTRAINT "BillingScheduleRow_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "CustomerPoLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_vatCodeId_fkey" FOREIGN KEY ("vatCodeId") REFERENCES "VatCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptAllocation" ADD CONSTRAINT "ReceiptAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptOpeningAllocation" ADD CONSTRAINT "ReceiptOpeningAllocation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "Receipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReceiptOpeningAllocation" ADD CONSTRAINT "ReceiptOpeningAllocation_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "CustomerOpeningBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNote" ADD CONSTRAINT "CustomerCreditNote_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNote" ADD CONSTRAINT "CustomerCreditNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNoteLine" ADD CONSTRAINT "CustomerCreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "CustomerCreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerCreditNoteLine" ADD CONSTRAINT "CustomerCreditNoteLine_invoiceLineId_fkey" FOREIGN KEY ("invoiceLineId") REFERENCES "InvoiceLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOpeningAllocation" ADD CONSTRAINT "SupplierOpeningAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "SupplierPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierOpeningAllocation" ADD CONSTRAINT "SupplierOpeningAllocation_openingBalanceId_fkey" FOREIGN KEY ("openingBalanceId") REFERENCES "SupplierOpeningBalance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
