-- CreateTable
CREATE TABLE "SalesAccountAnswer" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "questionKey" TEXT,
    "customQuestion" TEXT,
    "answer" TEXT NOT NULL,
    "detail" TEXT,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesAccountAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesAccountAnswer_salesAccountId_questionKey_key" ON "SalesAccountAnswer"("salesAccountId", "questionKey");

-- CreateIndex
CREATE INDEX "SalesAccountAnswer_salesAccountId_idx" ON "SalesAccountAnswer"("salesAccountId");

-- AddForeignKey
ALTER TABLE "SalesAccountAnswer" ADD CONSTRAINT "SalesAccountAnswer_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
