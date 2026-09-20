-- CreateEnum
CREATE TYPE "FunnelMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED');

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "lostToAmount" DECIMAL(14,2),
ADD COLUMN     "lostToPartner" TEXT,
ADD COLUMN     "lostToProduct" TEXT,
ADD COLUMN     "offeredOn" TIMESTAMP(3),
ADD COLUMN     "useCase" TEXT;

-- CreateTable
CREATE TABLE "FunnelMeeting" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "heldOn" TIMESTAMP(3) NOT NULL,
    "status" "FunnelMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "ranByEmployeeId" TEXT NOT NULL,
    "note" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FunnelMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelMeetingAttendee" (
    "id" TEXT NOT NULL,
    "funnelMeetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FunnelMeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FunnelMeetingReview" (
    "id" TEXT NOT NULL,
    "funnelMeetingId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,

    CONSTRAINT "FunnelMeetingReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FunnelMeeting_weekStart_key" ON "FunnelMeeting"("weekStart");

-- CreateIndex
CREATE INDEX "FunnelMeeting_status_heldOn_idx" ON "FunnelMeeting"("status", "heldOn");

-- CreateIndex
CREATE INDEX "FunnelMeetingAttendee_employeeId_idx" ON "FunnelMeetingAttendee"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelMeetingAttendee_funnelMeetingId_employeeId_key" ON "FunnelMeetingAttendee"("funnelMeetingId", "employeeId");

-- CreateIndex
CREATE INDEX "FunnelMeetingReview_employeeId_reviewedAt_idx" ON "FunnelMeetingReview"("employeeId", "reviewedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FunnelMeetingReview_funnelMeetingId_employeeId_key" ON "FunnelMeetingReview"("funnelMeetingId", "employeeId");

-- CreateIndex
CREATE INDEX "Opportunity_ownerEmployeeId_offeredOn_idx" ON "Opportunity"("ownerEmployeeId", "offeredOn");

-- AddForeignKey
ALTER TABLE "SalesComment" ADD CONSTRAINT "SalesComment_funnelMeetingId_fkey" FOREIGN KEY ("funnelMeetingId") REFERENCES "FunnelMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_funnelMeetingId_fkey" FOREIGN KEY ("funnelMeetingId") REFERENCES "FunnelMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMeeting" ADD CONSTRAINT "FunnelMeeting_ranByEmployeeId_fkey" FOREIGN KEY ("ranByEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMeetingAttendee" ADD CONSTRAINT "FunnelMeetingAttendee_funnelMeetingId_fkey" FOREIGN KEY ("funnelMeetingId") REFERENCES "FunnelMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMeetingAttendee" ADD CONSTRAINT "FunnelMeetingAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMeetingReview" ADD CONSTRAINT "FunnelMeetingReview_funnelMeetingId_fkey" FOREIGN KEY ("funnelMeetingId") REFERENCES "FunnelMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FunnelMeetingReview" ADD CONSTRAINT "FunnelMeetingReview_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─────────────────────────────────────────────────────────────────────────
-- Backfill: give already-quoted deals an offer date.
--
-- `offeredOn` decides funnel membership (§27.2, and the comment on the column
-- itself), and it is stamped going forward when a deal's stage first reaches
-- QUOTATION_SUBMITTED. Every deal quoted BEFORE this migration has no such
-- stamp, so without this they would all be invisible in the funnel on day one.
--
-- `stageChangedAt` is the best date we hold, and it is not the right one: it
-- records the LAST stage change, not the move to QUOTATION_SUBMITTED. A deal
-- quoted in March and moved to Negotiation in August will read August.
--
-- That is accepted rather than hidden, for two reasons: it is the only date in
-- the table, and `offeredOn` is editable in the grid, so a wrong date is a
-- correction somebody makes in five seconds rather than a dead end.
--
-- Rows touched: deals at or past QUOTATION_SUBMITTED, plus every WON or LOST
-- deal whatever its stage — you cannot win or lose a deal you never quoted.
-- CANCELLED is deliberately excluded: a deal can be shelved before it is
-- quoted, and guessing would put rows in the funnel that were never offered.
-- ─────────────────────────────────────────────────────────────────────────
UPDATE "Opportunity"
SET "offeredOn" = date_trunc('day', "stageChangedAt")
WHERE "offeredOn" IS NULL
  AND (
    "stage" IN ('QUOTATION_SUBMITTED', 'NEGOTIATION', 'AWAITING_DECISION')
    OR "status" IN ('WON', 'LOST')
  );
