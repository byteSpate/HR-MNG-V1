-- A sales target covers a date range inside one calendar year, not only
-- "from a start quarter to 31 December" (owner, 2026-11-10).
--
-- Existing targets keep exactly the same meaning: they start on the first day
-- of their start quarter and end on 31 December. A whole quarter counts as a
-- whole quarter in target.plan.ts, so every quarter's target is unchanged.
-- startQuarter stays, filled from startDate, so code from before this change
-- still works while a deploy is under way.

ALTER TABLE "SalesTarget" ADD COLUMN "startDate" DATE;
ALTER TABLE "SalesTarget" ADD COLUMN "endDate" DATE;

UPDATE "SalesTarget"
SET "startDate" = make_date("calendarYear", ("startQuarter" - 1) * 3 + 1, 1),
    "endDate"   = make_date("calendarYear", 12, 31);

ALTER TABLE "SalesTarget" ALTER COLUMN "startDate" SET NOT NULL;
ALTER TABLE "SalesTarget" ALTER COLUMN "endDate" SET NOT NULL;
