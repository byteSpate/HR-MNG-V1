-- CreateEnum
CREATE TYPE "EmployeeChangeField" AS ENUM ('NATIONAL_ID');

-- CreateEnum
CREATE TYPE "EmployeeChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "EmployeeChangeRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "field" "EmployeeChangeField" NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT NOT NULL,
    "status" "EmployeeChangeStatus" NOT NULL DEFAULT 'PENDING',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeChangeRequest_employeeId_field_status_idx" ON "EmployeeChangeRequest"("employeeId", "field", "status");

-- AddForeignKey
ALTER TABLE "EmployeeChangeRequest" ADD CONSTRAINT "EmployeeChangeRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
