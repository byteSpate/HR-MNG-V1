-- A "No VAT" code at 0%, for a PO, bill or invoice line that carries no VAT.
-- Safe to run twice: an existing NOVAT code is left alone.
INSERT INTO "VatCode" ("id", "code", "name", "ratePercent", "isActive", "createdAt", "updatedAt")
VALUES (gen_random_uuid()::text, 'NOVAT', 'No VAT', 0.00, true, now(), now())
ON CONFLICT ("code") DO NOTHING;
