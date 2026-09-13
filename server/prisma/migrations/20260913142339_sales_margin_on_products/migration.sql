-- AlterTable
ALTER TABLE "Opportunity" DROP COLUMN "marginPercent";

-- AlterTable
ALTER TABLE "OpportunityLine" ADD COLUMN     "marginPercent" DECIMAL(5,2);
