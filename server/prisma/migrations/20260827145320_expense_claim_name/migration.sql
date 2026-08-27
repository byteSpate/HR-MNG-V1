-- AlterTable
ALTER TABLE "ExpenseClaim" ADD COLUMN     "name" TEXT;

-- Backfill. `description` is where people had been writing the name, because
-- there was nowhere else to put it — the screenshot that prompted this column
-- shows "Water Jar" sitting in it. Copying it across keeps every existing
-- claim identifiable instead of leaving a page of rows labelled only by
-- category.
--
-- Truncated to 200 to match the validator's ceiling, and `description` is
-- deliberately left alone: a long note keeps its detail, and the name is a
-- label rather than a replacement for it.
UPDATE "ExpenseClaim"
SET "name" = LEFT(TRIM("description"), 200)
WHERE "name" IS NULL
  AND "description" IS NOT NULL
  AND TRIM("description") <> '';
