-- CreateEnum
CREATE TYPE "DocumentLinkKind" AS ENUM ('GENERAL', 'COSTING_BOQ');

-- AlterTable
ALTER TABLE "OpportunityDocumentLink" ADD COLUMN     "kind" "DocumentLinkKind" NOT NULL DEFAULT 'GENERAL',
ADD COLUMN     "quoteId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "nextRenewalOn" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "OpportunityDocumentLink_quoteId_idx" ON "OpportunityDocumentLink"("quoteId");

-- AddForeignKey
ALTER TABLE "OpportunityDocumentLink" ADD CONSTRAINT "OpportunityDocumentLink_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "OpportunityQuote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The old "Quotation documents" links become Costing and BOQ links (owner,
-- 2026-10-18). They stay tied to no quote.
UPDATE "OpportunityDocumentLink" SET "kind" = 'COSTING_BOQ' WHERE "stage" = 'COMMERCIAL_NEGOTIATION';

-- The heatmap group's new name (owner, 2026-10-18).
UPDATE "HeatmapGroup" SET "title" = 'Collaboration and Surveillance' WHERE "title" = 'Phones and building security';
