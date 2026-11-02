-- CreateEnum
CREATE TYPE "SalesTaskType" AS ENUM ('VISIT_FOLLOW_UP', 'QUOTATION_SENT', 'REQUIREMENT_SENT', 'CALL_OR_EMAIL', 'LEARNING', 'INTERNAL_WORK', 'OTHER');

-- AlterEnum
ALTER TYPE "SalesTaskOrigin" ADD VALUE 'TAKE_OUT';

-- AlterTable
ALTER TABLE "Opportunity" ADD COLUMN     "expectedQuoteOn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "SalesTask" ADD COLUMN     "type" "SalesTaskType" NOT NULL DEFAULT 'OTHER';
