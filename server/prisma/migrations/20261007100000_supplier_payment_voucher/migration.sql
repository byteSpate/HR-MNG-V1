-- Supplier payments get a voucher number (PV-0001), a payment method and an
-- optional bank. Each payment also keeps the bill total and the balance it
-- left, so an old voucher never changes. Additive only. Old payments are
-- numbered oldest first, so the next number follows the last one. The number
-- and the saved figures are locked (NOT NULL) at the end.

-- CreateEnum
CREATE TYPE "SupplierPaymentMethod" AS ENUM ('BANK_TRANSFER', 'CHEQUE', 'MOBILE_BANKING');

-- AlterTable
ALTER TABLE "SupplierPayment" ADD COLUMN "number" TEXT,
ADD COLUMN "paymentMethod" "SupplierPaymentMethod",
ADD COLUMN "bankName" TEXT;

-- Number the payments that already exist, oldest first.
UPDATE "SupplierPayment" p
SET "number" = 'PV-' || LPAD(x.n::text, 4, '0')
FROM (
  SELECT "id", ROW_NUMBER() OVER (ORDER BY "createdAt", "id") AS n
  FROM "SupplierPayment"
) x
WHERE p."id" = x."id";

-- The next payment follows the last one.
INSERT INTO "IdCounter" ("id", "value")
VALUES ('PV', (SELECT COUNT(*) FROM "SupplierPayment"))
ON CONFLICT ("id") DO UPDATE SET "value" = EXCLUDED."value";

-- Save the figures for payments that already exist. For each one: the bill
-- total (lines with VAT, less credit notes approved by the time the payment
-- was saved), and the balance after it (that total, less every approved
-- payment saved at or before it, itself included). Same order as new
-- payments: by the time saved, then by id. A payment that was already
-- reversed counts itself, so it shows the balance it had when it was
-- recorded. An older payment that was reversed later is not counted, because
-- nothing here says when it was reversed. For a bill in US dollars the same
-- two figures are also worked out in dollars at the bill's own rate.
ALTER TABLE "SupplierPaymentAllocation"
  ADD COLUMN "billTotal" DECIMAL(14,2),
  ADD COLUMN "balanceAfter" DECIMAL(14,2),
  ADD COLUMN "billTotalUsd" DECIMAL(14,2),
  ADD COLUMN "balanceAfterUsd" DECIMAL(14,2);

UPDATE "SupplierPaymentAllocation" ra
SET "billTotal" = f.total,
    "balanceAfter" = f.total - f.paid,
    "billTotalUsd" = CASE WHEN f.currency = 'USD' AND f.fx > 0 THEN ROUND(f.total / f.fx, 2) END,
    "balanceAfterUsd" = CASE WHEN f.currency = 'USD' AND f.fx > 0 THEN ROUND((f.total - f.paid) / f.fx, 2) END
FROM (
  SELECT
    a."id",
    b."currency"::text AS currency,
    COALESCE(b."fxRateToBdt", 0) AS fx,
    (SELECT COALESCE(SUM(l."amount" + l."vatAmount"), 0) FROM "SupplierBillLine" l WHERE l."billId" = a."billId")
    - (SELECT COALESCE(SUM(cl."amount" + cl."vatAmount"), 0)
         FROM "SupplierCreditNote" cn
         JOIN "SupplierCreditNoteLine" cl ON cl."creditNoteId" = cn."id"
        WHERE cn."billId" = a."billId" AND cn."status" = 'APPROVED' AND cn."approvedAt" <= p."createdAt") AS total,
    (SELECT COALESCE(SUM(a2."amount"), 0)
       FROM "SupplierPaymentAllocation" a2
       JOIN "SupplierPayment" p2 ON p2."id" = a2."paymentId"
      WHERE a2."billId" = a."billId"
        AND (p2."status" = 'APPROVED' OR p2."id" = p."id")
        AND (p2."createdAt" < p."createdAt" OR (p2."createdAt" = p."createdAt" AND p2."id" <= p."id"))) AS paid
  FROM "SupplierPaymentAllocation" a
  JOIN "SupplierPayment" p ON p."id" = a."paymentId"
  JOIN "SupplierBill" b ON b."id" = a."billId"
) f
WHERE ra."id" = f."id";

ALTER TABLE "SupplierPaymentAllocation"
  ALTER COLUMN "billTotal" SET NOT NULL,
  ALTER COLUMN "balanceAfter" SET NOT NULL;

-- Lock the number.
ALTER TABLE "SupplierPayment" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SupplierPayment_number_key" ON "SupplierPayment"("number");
