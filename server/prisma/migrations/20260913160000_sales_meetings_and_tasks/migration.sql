-- CreateEnum
CREATE TYPE "SalesMeetingMode" AS ENUM ('CUSTOMER_SITE', 'OUR_OFFICE', 'ONLINE');

-- CreateEnum
CREATE TYPE "SalesMeetingStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SalesMeetingSide" AS ENUM ('OURS', 'THEIRS');

-- CreateEnum
CREATE TYPE "SalesTaskOrigin" AS ENUM ('SELF', 'FUNNEL_MEETING');

-- CreateEnum
CREATE TYPE "SalesTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "SalesTaskStatus" AS ENUM ('PENDING', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "SalesMeeting" (
    "id" TEXT NOT NULL,
    "salesAccountId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "title" TEXT NOT NULL,
    "mode" "SalesMeetingMode" NOT NULL DEFAULT 'CUSTOMER_SITE',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "location" TEXT,
    "notes" TEXT,
    "status" "SalesMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "cancelReason" TEXT,
    "outcome" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "side" "SalesMeetingSide" NOT NULL,
    "employeeId" TEXT,
    "contactId" TEXT,
    "name" TEXT,
    "designation" TEXT,

    CONSTRAINT "SalesMeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesTask" (
    "id" TEXT NOT NULL,
    "origin" "SalesTaskOrigin" NOT NULL DEFAULT 'SELF',
    "salesAccountId" TEXT,
    "opportunityId" TEXT,
    "meetingId" TEXT,
    "projectId" TEXT,
    "funnelMeetingId" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "priority" "SalesTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "assignedToEmployeeId" TEXT NOT NULL,
    "assignedByEmployeeId" TEXT,
    "status" "SalesTaskStatus" NOT NULL DEFAULT 'PENDING',
    "outcome" TEXT,
    "cancelReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SalesMeeting_salesAccountId_scheduledAt_idx" ON "SalesMeeting"("salesAccountId", "scheduledAt");

-- CreateIndex
CREATE INDEX "SalesMeeting_status_scheduledAt_idx" ON "SalesMeeting"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "SalesMeeting_opportunityId_idx" ON "SalesMeeting"("opportunityId");

-- CreateIndex
CREATE INDEX "SalesMeetingAttendee_meetingId_idx" ON "SalesMeetingAttendee"("meetingId");

-- CreateIndex
CREATE INDEX "SalesMeetingAttendee_employeeId_idx" ON "SalesMeetingAttendee"("employeeId");

-- CreateIndex
CREATE INDEX "SalesTask_status_dueOn_idx" ON "SalesTask"("status", "dueOn");

-- CreateIndex
CREATE INDEX "SalesTask_assignedToEmployeeId_status_dueOn_idx" ON "SalesTask"("assignedToEmployeeId", "status", "dueOn");

-- CreateIndex
CREATE INDEX "SalesTask_funnelMeetingId_idx" ON "SalesTask"("funnelMeetingId");

-- CreateIndex
CREATE INDEX "SalesTask_salesAccountId_status_idx" ON "SalesTask"("salesAccountId", "status");

-- AddForeignKey
ALTER TABLE "Opportunity" ADD CONSTRAINT "Opportunity_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "SalesMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMeeting" ADD CONSTRAINT "SalesMeeting_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMeetingAttendee" ADD CONSTRAINT "SalesMeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "SalesMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMeetingAttendee" ADD CONSTRAINT "SalesMeetingAttendee_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMeetingAttendee" ADD CONSTRAINT "SalesMeetingAttendee_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "SalesContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_salesAccountId_fkey" FOREIGN KEY ("salesAccountId") REFERENCES "SalesAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "Opportunity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "SalesMeeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_assignedToEmployeeId_fkey" FOREIGN KEY ("assignedToEmployeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesTask" ADD CONSTRAINT "SalesTask_assignedByEmployeeId_fkey" FOREIGN KEY ("assignedByEmployeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
