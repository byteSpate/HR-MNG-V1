-- Networking Opportunities use six new stages. The three Networking-only old
-- stages leave the enum. Software stages are untouched.
CREATE TYPE "OpportunityStage_new" AS ENUM (
  'REQUIREMENT_RECEIVED', 'NEGOTIATION', 'AWAITING_DECISION',
  'REQUIREMENT_GATHERING', 'BRD_SENT', 'SRS_SENT', 'PROPOSAL_SUBMITTED', 'PROPOSAL_REVISION',
  'ASSIGNED_QUALIFIED', 'DISCOVERY_DESIGN', 'TECHNICAL_VALIDATION',
  'COMMERCIAL_NEGOTIATION', 'CUSTOMER_PROCUREMENT', 'PO_RECEIVED'
);

ALTER TABLE "Opportunity" ALTER COLUMN "stage" DROP DEFAULT;
ALTER TABLE "Opportunity" ALTER COLUMN "stage" TYPE "OpportunityStage_new" USING (
  CASE "stage"::text
    WHEN 'REQUIREMENT_RECEIVED' THEN CASE WHEN "track" = 'NETWORKING' THEN 'ASSIGNED_QUALIFIED' ELSE 'REQUIREMENT_RECEIVED' END
    WHEN 'SOLUTION_DESIGN' THEN 'DISCOVERY_DESIGN'
    WHEN 'OEM_PRICING' THEN 'COMMERCIAL_NEGOTIATION'
    WHEN 'QUOTATION_SUBMITTED' THEN 'COMMERCIAL_NEGOTIATION'
    WHEN 'NEGOTIATION' THEN CASE WHEN "track" = 'NETWORKING' THEN 'COMMERCIAL_NEGOTIATION' ELSE 'NEGOTIATION' END
    WHEN 'AWAITING_DECISION' THEN CASE WHEN "track" = 'NETWORKING' THEN 'CUSTOMER_PROCUREMENT' ELSE 'AWAITING_DECISION' END
    ELSE "stage"::text
  END
)::"OpportunityStage_new";
-- The default is not put back. The first stage depends on the track, so one
-- default would be wrong for one of them. Every Opportunity is created by
-- createOpportunity or the Hand-over, and both name their stage.

ALTER TABLE "OpportunityDocumentLink" ALTER COLUMN "stage" TYPE "OpportunityStage_new" USING (
  CASE "stage"::text
    WHEN 'SOLUTION_DESIGN' THEN 'DISCOVERY_DESIGN'
    WHEN 'OEM_PRICING' THEN 'COMMERCIAL_NEGOTIATION'
    WHEN 'QUOTATION_SUBMITTED' THEN 'COMMERCIAL_NEGOTIATION'
    ELSE "stage"::text
  END
)::"OpportunityStage_new";

DROP TYPE "OpportunityStage";
ALTER TYPE "OpportunityStage_new" RENAME TO "OpportunityStage";
