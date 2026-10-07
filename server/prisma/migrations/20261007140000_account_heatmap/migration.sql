-- Heatmap tab on a sales account (owner, 2026-10-07). Two new tables; nothing
-- existing changes. The old "IT setup" questions on About are removed in code
-- only: the owner confirmed none were answered, and any stray answer row stays
-- in the table, unread.

-- CreateEnum
CREATE TYPE "HeatmapNeed" AS ENUM ('NEED', 'NO_NEED');

-- CreateTable
CREATE TABLE "SalesAccountHeatmapNeed" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "card" TEXT NOT NULL,
    "need" "HeatmapNeed" NOT NULL,
    "reason" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAccountHeatmapNeed_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAccountHeatmapItem" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "card" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT,
    "quantity" INTEGER NOT NULL,
    "site" TEXT,
    "boughtFrom" TEXT,
    "boughtOn" DATE,
    "supportEndsOn" DATE,
    "endOfLifeOn" DATE,
    "supportBy" TEXT,
    "notes" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAccountHeatmapItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountHeatmapNeed_salesAccountId_card_key" ON "SalesAccountHeatmapNeed"("salesAccountId", "card");

-- CreateIndex
CREATE INDEX "SalesAccountHeatmapItem_salesAccountId_card_idx" ON "SalesAccountHeatmapItem"("salesAccountId", "card");

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapNeed" ADD CONSTRAINT "SalesAccountHeatmapNeed_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapItem" ADD CONSTRAINT "SalesAccountHeatmapItem_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
