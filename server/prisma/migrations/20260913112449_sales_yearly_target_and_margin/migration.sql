-- A target becomes a yearly amount of taka instead of a quarterly count of
-- deals. The old rows count deals, which cannot be turned into money, and
-- "amount" is NOT NULL, so they are removed rather than guessed at. Phase 2
-- never reached production, so only the development database holds any.
DELETE FROM "SalesTarget";

-- DropIndex
DROP INDEX "SalesTarget_calendarYear_quarter_idx";

-- DropIndex
DROP INDEX "SalesTarget_employeeId_calendarYear_quarter_key";

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "marginPercent" DECIMAL(5,2);

-- AlterTable
ALTER TABLE "SalesTarget" DROP COLUMN "quarter",
DROP COLUMN "targetDeals",
ADD COLUMN     "amount" DECIMAL(14,2) NOT NULL,
ADD COLUMN     "startQuarter" INTEGER NOT NULL DEFAULT 1;

-- CreateIndex
CREATE INDEX "SalesTarget_calendarYear_idx" ON "SalesTarget"("calendarYear");

-- CreateIndex
CREATE UNIQUE INDEX "SalesTarget_employeeId_calendarYear_key" ON "SalesTarget"("employeeId", "calendarYear");
