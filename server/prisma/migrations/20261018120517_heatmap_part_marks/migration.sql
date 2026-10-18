-- Heatmap part marks (owner, 2026-10-18). A tick or a cross on each part
-- replaces the hand-picked product colour and the "in scope" ticks. The product
-- colour is now worked out from its parts. Order matters: the new tables are
-- made first, the saved picks are copied across, and only then are the old
-- tables dropped.

-- CreateEnum
CREATE TYPE "HeatmapMarkState" AS ENUM ('GREEN', 'RED');

-- CreateTable
CREATE TABLE "SalesAccountHeatmapMark" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "partId" TEXT NOT NULL,
    "state" "HeatmapMarkState" NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "SalesAccountHeatmapMark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesAccountHeatmapNote" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

CONSTRAINT "SalesAccountHeatmapNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesAccountHeatmapMark_partId_idx" ON "SalesAccountHeatmapMark"("partId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountHeatmapMark_salesAccountId_partId_key" ON "SalesAccountHeatmapMark"("salesAccountId", "partId");

-- CreateIndex
CREATE INDEX "SalesAccountHeatmapNote_productId_idx" ON "SalesAccountHeatmapNote"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountHeatmapNote_salesAccountId_productId_key" ON "SalesAccountHeatmapNote"("salesAccountId", "productId");

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapMark" ADD CONSTRAINT "SalesAccountHeatmapMark_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapMark" ADD CONSTRAINT "SalesAccountHeatmapMark_partId_fkey" FOREIGN KEY ("partId") REFERENCES "HeatmapPart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapNote" ADD CONSTRAINT "SalesAccountHeatmapNote_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesAccountHeatmapNote" ADD CONSTRAINT "SalesAccountHeatmapNote_productId_fkey" FOREIGN KEY ("productId") REFERENCES "HeatmapProduct"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A product with no parts gets one part, so it can be ticked or crossed.
INSERT INTO "HeatmapPart" ("id", "productId", "title", "position", "hidden", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, p."id", 'Whole product', 1, false, now(), now()
FROM "HeatmapProduct" p
WHERE NOT EXISTS (SELECT 1 FROM "HeatmapPart" x WHERE x."productId" = p."id");

-- Green product: its ticked parts become a tick. If no part was ticked, every
-- part does. A tick on a product with no colour is not copied: it stays Gray.
INSERT INTO "SalesAccountHeatmapMark" ("id", "salesAccountId", "partId", "state", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pk."salesAccountId", pt."id", 'GREEN', pk."updatedBy", pk."createdAt", pk."updatedAt"
FROM "SalesAccountHeatmapPick" pk
JOIN "HeatmapPart" pt ON pt."productId" = pk."productId"
WHERE pk."colour" = 'GREEN'
  AND (
    EXISTS (
      SELECT 1 FROM "SalesAccountHeatmapScope" sc
      WHERE sc."salesAccountId" = pk."salesAccountId" AND sc."partId" = pt."id"
    )
    OR NOT EXISTS (
      SELECT 1 FROM "SalesAccountHeatmapScope" s2
      JOIN "HeatmapPart" p2 ON p2."id" = s2."partId"
      WHERE s2."salesAccountId" = pk."salesAccountId" AND p2."productId" = pk."productId"
    )
  );

-- Red product: every part becomes a cross, and the old reason becomes the note.
INSERT INTO "SalesAccountHeatmapMark" ("id", "salesAccountId", "partId", "state", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pk."salesAccountId", pt."id", 'RED', pk."updatedBy", pk."createdAt", pk."updatedAt"
FROM "SalesAccountHeatmapPick" pk
JOIN "HeatmapPart" pt ON pt."productId" = pk."productId"
WHERE pk."colour" = 'RED';

INSERT INTO "SalesAccountHeatmapNote" ("id", "salesAccountId", "productId", "note", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, pk."salesAccountId", pk."productId", btrim(pk."reason"), pk."updatedBy", pk."createdAt", pk."updatedAt"
FROM "SalesAccountHeatmapPick" pk
WHERE pk."colour" = 'RED' AND pk."reason" IS NOT NULL AND btrim(pk."reason") <> '';

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapPick" DROP CONSTRAINT "SalesAccountHeatmapPick_productId_fkey";

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapPick" DROP CONSTRAINT "SalesAccountHeatmapPick_salesAccountId_fkey";

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapScope" DROP CONSTRAINT "SalesAccountHeatmapScope_partId_fkey";

-- DropForeignKey
ALTER TABLE "SalesAccountHeatmapScope" DROP CONSTRAINT "SalesAccountHeatmapScope_salesAccountId_fkey";

-- DropTable
DROP TABLE "SalesAccountHeatmapPick";

-- DropTable
DROP TABLE "SalesAccountHeatmapScope";

-- DropEnum
DROP TYPE "HeatmapPickColour";
