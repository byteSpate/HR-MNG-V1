-- AlterEnum
ALTER TYPE "ReceivableDocStatus" ADD VALUE 'REVERSED';

-- AlterEnum
ALTER TYPE "SupplierDocStatus" ADD VALUE 'REVERSED';

-- DropForeignKey
ALTER TABLE "BillingScheduleRow" DROP CONSTRAINT "BillingScheduleRow_poId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerOpeningBalance" DROP CONSTRAINT "CustomerOpeningBalance_customerId_fkey";

-- DropForeignKey
ALTER TABLE "EarningEvent" DROP CONSTRAINT "EarningEvent_poId_fkey";

-- DropForeignKey
ALTER TABLE "EarningEventLine" DROP CONSTRAINT "EarningEventLine_eventId_fkey";

-- DropForeignKey
ALTER TABLE "EarningEventLine" DROP CONSTRAINT "EarningEventLine_poLineId_fkey";

-- DropForeignKey
ALTER TABLE "EarningRun" DROP CONSTRAINT "EarningRun_journalId_fkey";

-- DropForeignKey
ALTER TABLE "MonthlyEarning" DROP CONSTRAINT "MonthlyEarning_poLineId_fkey";

-- DropForeignKey
ALTER TABLE "MonthlyEarning" DROP CONSTRAINT "MonthlyEarning_runId_fkey";

-- DropForeignKey
ALTER TABLE "ReceiptOpeningAllocation" DROP CONSTRAINT "ReceiptOpeningAllocation_openingBalanceId_fkey";

-- DropForeignKey
ALTER TABLE "ReceiptOpeningAllocation" DROP CONSTRAINT "ReceiptOpeningAllocation_receiptId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierBillLine" DROP CONSTRAINT "SupplierBillLine_opportunityId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierOpeningAllocation" DROP CONSTRAINT "SupplierOpeningAllocation_openingBalanceId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierOpeningAllocation" DROP CONSTRAINT "SupplierOpeningAllocation_paymentId_fkey";

-- DropForeignKey
ALTER TABLE "SupplierOpeningBalance" DROP CONSTRAINT "SupplierOpeningBalance_supplierId_fkey";

-- DropIndex
DROP INDEX "SupplierBillLine_opportunityId_idx";

-- AlterTable
ALTER TABLE "CustomerCreditNote" ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "sentBackBy" TEXT;

-- AlterTable
ALTER TABLE "CustomerPo" DROP COLUMN "trackDelivery";

-- AlterTable
ALTER TABLE "CustomerPoLine" DROP COLUMN "contractEnd",
DROP COLUMN "contractStart",
DROP COLUMN "earnKind";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "sentBackBy" TEXT;

-- AlterTable
ALTER TABLE "OpportunityLine" ADD COLUMN     "supplierId" TEXT;

-- AlterTable
-- opportunityId is added NOT NULL directly here (no nullable/fill/SET NOT
-- NULL dance): the pre-migration check found zero Receipt rows, so there is
-- nothing to backfill and no possible violation.
ALTER TABLE "Receipt" ADD COLUMN     "opportunityId" TEXT NOT NULL,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedBy" TEXT;

-- AlterTable
ALTER TABLE "ReceiptAllocation" DROP COLUMN "matchedAt";

-- AlterTable
-- nameKey added nullable first: existing suppliers need a fill before it can
-- be made required (see the UPDATE + SET NOT NULL below, after the table is
-- otherwise settled).
ALTER TABLE "Supplier" ADD COLUMN     "nameKey" TEXT;

-- AlterTable
-- opportunityId is added NOT NULL directly here for the same reason as
-- Receipt above: zero SupplierBill rows found, nothing to backfill.
ALTER TABLE "SupplierBill" ADD COLUMN     "opportunityId" TEXT NOT NULL,
ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "sentBackBy" TEXT;

-- AlterTable
ALTER TABLE "SupplierBillLine" DROP COLUMN "opportunityId";

-- AlterTable
ALTER TABLE "SupplierCreditNote" ADD COLUMN     "rejectionNote" TEXT,
ADD COLUMN     "sentBackAt" TIMESTAMP(3),
ADD COLUMN     "sentBackBy" TEXT;

-- AlterTable
-- opportunityId is added NOT NULL directly here for the same reason as
-- Receipt above: zero SupplierPayment rows found, nothing to backfill.
ALTER TABLE "SupplierPayment" ADD COLUMN     "opportunityId" TEXT NOT NULL,
ADD COLUMN     "reversalReason" TEXT,
ADD COLUMN     "reversedAt" TIMESTAMP(3),
ADD COLUMN     "reversedBy" TEXT;

-- AlterTable
ALTER TABLE "SupplierPaymentAllocation" DROP COLUMN "matchedAt";

-- DropTable
DROP TABLE "BillingScheduleRow";

-- DropTable
DROP TABLE "CustomerOpeningBalance";

-- DropTable
DROP TABLE "EarningEvent";

-- DropTable
DROP TABLE "EarningEventLine";

-- DropTable
DROP TABLE "EarningRun";

-- DropTable
DROP TABLE "MonthlyEarning";

-- DropTable
DROP TABLE "ReceiptOpeningAllocation";

-- DropTable
DROP TABLE "SupplierOpeningAllocation";

-- DropTable
DROP TABLE "SupplierOpeningBalance";

-- DropEnum
DROP TYPE "EarnKind";

-- DropEnum
DROP TYPE "EarningRunStatus";

-- Backfill: Supplier.nameKey from the name, same rule the migration's
-- `Supplier_nameKey_key` unique index is about to enforce. Must run before
-- that index and before SET NOT NULL below.
UPDATE "Supplier" SET "nameKey" = regexp_replace(lower("name"), '[^a-z0-9]', '', 'g');

-- AlterTable
ALTER TABLE "Supplier" ALTER COLUMN "nameKey" SET NOT NULL;

-- VAT: only Standard 15% is offered from now on.
UPDATE "VatCode" SET "isActive" = false WHERE "code" IN ('ZERO', 'EXEMPT');

-- CreateIndex
CREATE INDEX "OpportunityLine_supplierId_idx" ON "OpportunityLine"("supplierId");

-- CreateIndex
CREATE INDEX "Receipt_opportunityId_idx" ON "Receipt"("opportunityId");

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_nameKey_key" ON "Supplier"("nameKey");

-- CreateIndex
CREATE INDEX "SupplierBill_opportunityId_idx" ON "SupplierBill"("opportunityId");

-- CreateIndex
CREATE INDEX "SupplierPayment_opportunityId_idx" ON "SupplierPayment"("opportunityId");

-- AddForeignKey
ALTER TABLE "SupplierBill" ADD CONSTRAINT "SupplierBill_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierPayment" ADD CONSTRAINT "SupplierPayment_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Receipt" ADD CONSTRAINT "Receipt_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OpportunityLine" ADD CONSTRAINT "OpportunityLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
