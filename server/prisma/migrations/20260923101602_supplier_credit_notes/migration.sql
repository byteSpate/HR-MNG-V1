-- CreateTable
CREATE TABLE "SupplierCreditNote" (
    "id" TEXT NOT NULL,
    "billId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "SupplierDocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplierCreditNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCreditNoteLine" (
    "id" TEXT NOT NULL,
    "creditNoteId" TEXT NOT NULL,
    "billLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "vatAmount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "SupplierCreditNoteLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplierCreditNote_billId_idx" ON "SupplierCreditNote"("billId");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_supplierId_idx" ON "SupplierCreditNote"("supplierId");

-- CreateIndex
CREATE INDEX "SupplierCreditNote_status_idx" ON "SupplierCreditNote"("status");

-- CreateIndex
CREATE INDEX "SupplierCreditNoteLine_creditNoteId_idx" ON "SupplierCreditNoteLine"("creditNoteId");

-- CreateIndex
CREATE INDEX "SupplierCreditNoteLine_billLineId_idx" ON "SupplierCreditNoteLine"("billLineId");

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_billId_fkey" FOREIGN KEY ("billId") REFERENCES "SupplierBill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNote" ADD CONSTRAINT "SupplierCreditNote_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNoteLine" ADD CONSTRAINT "SupplierCreditNoteLine_creditNoteId_fkey" FOREIGN KEY ("creditNoteId") REFERENCES "SupplierCreditNote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCreditNoteLine" ADD CONSTRAINT "SupplierCreditNoteLine_billLineId_fkey" FOREIGN KEY ("billLineId") REFERENCES "SupplierBillLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
