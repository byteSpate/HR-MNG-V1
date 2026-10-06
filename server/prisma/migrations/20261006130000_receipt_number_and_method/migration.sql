-- Money receipts get a number (MR-0001), a payment method and an optional bank.
-- Each payment also keeps the invoice total and the balance it left, so an old
-- receipt never changes. Additive only. Old receipts are numbered oldest first,
-- so the next number follows the last one. The number and the saved figures are
-- locked (NOT NULL) at the end.

-- CreateEnum
CREATE TYPE "ReceiptPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'CHEQUE', 'MOBILE_BANKING');

-- AlterTable
ALTER TABLE "Receipt" ADD COLUMN "number" TEXT,
ADD COLUMN "paymentMethod" "ReceiptPaymentMethod",
ADD COLUMN "bankName" TEXT;

-- Number the receipts that already exist, oldest first.
UPDATE "Receipt" r
SET "number" = 'MR-' || LPAD(x.n::text, 4, '0')
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "Receipt"
) x
WHERE r."id" = x."id";

-- The next receipt follows the last one.
INSERT INTO "IdCounter" ("id", "value")
VALUES ('MR', (SELECT COUNT(*) FROM "Receipt"))
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value";

-- Save the figures for payments that already exist. For each one: the invoice
-- total (lines with VAT, less credit notes approved by the time the receipt was
-- saved), and the balance after it (that total, less every approved receipt
-- saved at or before it, itself included). Same order as new receipts: by the
-- time saved, then by id. A receipt that was already reversed counts itself, so
-- it shows the balance it had when it was recorded. An older receipt that was
-- reversed later is not counted, because nothing here says when it was reversed.
ALTER TABLE "ReceiptAllocation"
  ADD COLUMN "invoiceTotal" DECIMAL(14,2),
  ADD COLUMN "balanceAfter" DECIMAL(14,2);

UPDATE "ReceiptAllocation" ra
SET "invoiceTotal" = f.total,
    "balanceAfter" = f.total - f.paid
FROM (
  SELECT
    a."id",
    (SELECT COALESCE(SUM(l."amount" + l."vatAmount"), 0) FROM "InvoiceLine" l WHERE l."invoiceId" = a."invoiceId")
    - (SELECT COALESCE(SUM(cl."amount" + cl."vatAmount"), 0)
         FROM "CustomerCreditNote" cn
         JOIN "CustomerCreditNoteLine" cl ON cl."creditNoteId" = cn."id"
        WHERE cn."invoiceId" = a."invoiceId" AND cn."status" = 'APPROVED' AND cn."approvedAt" <= r."createdAt") AS total,
    (SELECT COALESCE(SUM(a2."amount"), 0)
       FROM "ReceiptAllocation" a2
       JOIN "Receipt" r2 ON r2."id" = a2."receiptId"
      WHERE a2."invoiceId" = a."invoiceId"
        AND (r2."status" = 'APPROVED' OR r2."id" = r."id")
        AND (r2."createdAt" < r."createdAt" OR (r2."createdAt" = r."createdAt" AND r2."id" <= r."id"))) AS paid
  FROM "ReceiptAllocation" a
  JOIN "Receipt" r ON r."id" = a."receiptId"
) f
WHERE ra."id" = f."id";

ALTER TABLE "ReceiptAllocation"
  ALTER COLUMN "invoiceTotal" SET NOT NULL,
  ALTER COLUMN "balanceAfter" SET NOT NULL;

-- Lock the number.
ALTER TABLE "Receipt" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");
