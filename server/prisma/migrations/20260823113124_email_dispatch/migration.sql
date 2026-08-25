-- CreateTable
CREATE TABLE "EmailDispatch" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "entity" TEXT,
    "entityId" TEXT,
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDispatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailDispatch_createdAt_idx" ON "EmailDispatch"("createdAt");

-- CreateIndex
CREATE INDEX "EmailDispatch_kind_createdAt_idx" ON "EmailDispatch"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "EmailDispatch_entity_entityId_idx" ON "EmailDispatch"("entity", "entityId");
