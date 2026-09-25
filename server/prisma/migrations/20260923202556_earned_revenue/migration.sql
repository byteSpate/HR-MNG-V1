-- CreateEnum
CREATE TYPE "EarnKind" AS ENUM ('DELIVERY', 'ACCEPTANCE', 'MONTHLY');

-- CreateEnum
CREATE TYPE "EarningRunStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- AlterTable
ALTER TABLE "CustomerPo" ADD COLUMN     "trackDelivery" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "CustomerPoLine" ADD COLUMN     "contractEnd" TIMESTAMP(3),
ADD COLUMN     "contractStart" TIMESTAMP(3),
ADD COLUMN     "earnKind" "EarnKind";

-- CreateTable
CREATE TABLE "EarningEvent" (
    "id" TEXT NOT NULL,
    "poId" TEXT NOT NULL,
    "kind" "EarnKind" NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "evidenceRef" TEXT NOT NULL,
    "note" TEXT,
    "status" "ReceivableDocStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EarningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningEventLine" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "quantity" DECIMAL(14,2),
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "EarningEventLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EarningRun" (
    "id" TEXT NOT NULL,
    "runNo" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "status" "EarningRunStatus" NOT NULL DEFAULT 'DRAFT',
    "journalId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedBy" TEXT,
    "postedAt" TIMESTAMP(3),
    "reversedBy" TEXT,
    "reversedAt" TIMESTAMP(3),

    CONSTRAINT "EarningRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MonthlyEarning" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "poLineId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "MonthlyEarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EarningEvent_poId_idx" ON "EarningEvent"("poId");

-- CreateIndex
CREATE INDEX "EarningEvent_status_idx" ON "EarningEvent"("status");

-- CreateIndex
CREATE INDEX "EarningEventLine_poLineId_idx" ON "EarningEventLine"("poLineId");

-- CreateIndex
CREATE UNIQUE INDEX "EarningRun_runNo_key" ON "EarningRun"("runNo");

-- CreateIndex
CREATE INDEX "EarningRun_status_idx" ON "EarningRun"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EarningRun_year_month_key" ON "EarningRun"("year", "month");

-- CreateIndex
CREATE INDEX "MonthlyEarning_poLineId_idx" ON "MonthlyEarning"("poLineId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlyEarning_runId_poLineId_key" ON "MonthlyEarning"("runId", "poLineId");

-- AddForeignKey
ALTER TABLE "EarningEvent" ADD CONSTRAINT "EarningEvent_poId_fkey" FOREIGN KEY ("poId") REFERENCES "CustomerPo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningEventLine" ADD CONSTRAINT "EarningEventLine_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "EarningEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningEventLine" ADD CONSTRAINT "EarningEventLine_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "CustomerPoLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EarningRun" ADD CONSTRAINT "EarningRun_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "Journal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyEarning" ADD CONSTRAINT "MonthlyEarning_runId_fkey" FOREIGN KEY ("runId") REFERENCES "EarningRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MonthlyEarning" ADD CONSTRAINT "MonthlyEarning_poLineId_fkey" FOREIGN KEY ("poLineId") REFERENCES "CustomerPoLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
