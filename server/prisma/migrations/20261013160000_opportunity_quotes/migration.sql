-- CreateTable
CREATE TABLE "OpportunityQuote" (
    "id" TEXT NOT NULL,
    "opportunityId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "quotedOn" DATE NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "stage" "OpportunityStage" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpportunityQuote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OpportunityQuote_opportunityId_quotedOn_idx" ON "OpportunityQuote"("opportunityId", "quotedOn");

-- AddForeignKey
ALTER TABLE "OpportunityQuote" ADD CONSTRAINT "OpportunityQuote_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quote 1 for every Opportunity already on the Funnel with a price (owner,
-- 2026-10-13). No rebuild from the audit log: it mixes typo fixes with quotes.
INSERT INTO "OpportunityQuote" ("id", "opportunityId", "amount", "quotedOn", "stage", "createdBy", "updatedBy", "createdAt", "updatedAt")
SELECT gen_random_uuid(), o."id", o."amount", o."offeredOn"::date, o."stage",
       COALESCE(o."createdBy", 'system'), COALESCE(o."createdBy", 'system'), now(), now()
FROM "Opportunity" o
WHERE o."offeredOn" IS NOT NULL AND o."amount" IS NOT NULL;
