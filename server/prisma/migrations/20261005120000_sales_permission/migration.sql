-- CreateTable
CREATE TABLE "SalesPermission" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesPermission_pkey" PRIMARY KEY ("key")
);
