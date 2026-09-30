-- CreateTable
CREATE TABLE "PayrollSetting" (
    "id" TEXT NOT NULL DEFAULT 'payroll',
    "deductLossOfPay" BOOLEAN NOT NULL DEFAULT true,
    "recoverAssetsFromSalary" BOOLEAN NOT NULL DEFAULT true,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSetting_pkey" PRIMARY KEY ("id")
);
