-- AlterTable
ALTER TABLE "ExpenseClaim" ADD COLUMN     "travelFrom" TEXT,
ADD COLUMN     "travelTo" TEXT;

-- CreateTable
CREATE TABLE "ExpenseAttachment" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "format" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseAttachment_publicId_key" ON "ExpenseAttachment"("publicId");

-- CreateIndex
CREATE INDEX "ExpenseAttachment_claimId_uploadedAt_idx" ON "ExpenseAttachment"("claimId", "uploadedAt");

-- CreateIndex
CREATE INDEX "ExpenseClaim_expenseDate_idx" ON "ExpenseClaim"("expenseDate");

-- AddForeignKey
ALTER TABLE "ExpenseAttachment" ADD CONSTRAINT "ExpenseAttachment_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "ExpenseClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;
