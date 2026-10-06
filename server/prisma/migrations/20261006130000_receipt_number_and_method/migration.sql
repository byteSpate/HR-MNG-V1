-- Money receipts get a number (MR-0001), a payment method and an optional bank.
-- Additive only. Old receipts are numbered oldest first, so the next number
-- follows the last one. The number is locked (NOT NULL, unique) at the end.

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

-- Lock the number.
ALTER TABLE "Receipt" ALTER COLUMN "number" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Receipt_number_key" ON "Receipt"("number");
