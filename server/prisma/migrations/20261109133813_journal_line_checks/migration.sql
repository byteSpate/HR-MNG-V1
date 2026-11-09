-- Two rules every journal line already follows in the code, now also kept by
-- the database, so a future bug or a hand-run script cannot break them:
--
--   1. A line is a debit or a credit: one amount above zero, the other zero,
--      never negative. (assertLineShape in accounting.utils.ts.)
--   2. A line is for a customer or for a supplier, never both. (Only the
--      receivable posting code sets customerId, only the payable posting code
--      sets supplierId, and a hand-typed journal sets neither.)
--
-- NOT VALID: Postgres checks every row written from now on, but does not scan
-- the rows already there. So this migration cannot fail on old data during the
-- Heroku release step. Once production has been checked for rows that break a
-- rule (none are expected), run:
--   ALTER TABLE "JournalLine" VALIDATE CONSTRAINT "JournalLine_one_side_check";
--   ALTER TABLE "JournalLine" VALIDATE CONSTRAINT "JournalLine_customer_or_supplier_check";
--
-- Prisma does not model CHECK constraints, so `prisma migrate diff` neither
-- sees nor drops them.

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_one_side_check"
  CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" > 0) <> ("credit" > 0))
  NOT VALID;

ALTER TABLE "JournalLine"
  ADD CONSTRAINT "JournalLine_customer_or_supplier_check"
  CHECK ("customerId" IS NULL OR "supplierId" IS NULL)
  NOT VALID;
