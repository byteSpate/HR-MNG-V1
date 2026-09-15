-- CreateEnum
CREATE TYPE "SalesMinutesStatus" AS ENUM ('DRAFT', 'SENT', 'EDITED_AFTER_SENDING');

-- CreateEnum
CREATE TYPE "SalesMinutesSectionKind" AS ENUM ('PARAGRAPHS', 'BULLETS', 'SUBTOPICS', 'TABLE');

-- CreateTable
CREATE TABLE "SalesMeetingMinutes" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "purpose" TEXT,
    "meetingWithNote" TEXT,
    "requirementFound" BOOLEAN,
    "status" "SalesMinutesStatus" NOT NULL DEFAULT 'DRAFT',
    "lastSentAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesMeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMinutesSection" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "heading" TEXT NOT NULL,
    "kind" "SalesMinutesSectionKind" NOT NULL,
    "content" JSONB NOT NULL,

    CONSTRAINT "SalesMinutesSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMinutesPreparer" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "titleExtra" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesMinutesPreparer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMinutesSend" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentBy" TEXT NOT NULL,
    "sentTo" TEXT,
    "fileId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,

    CONSTRAINT "SalesMinutesSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesMinutesTemplate" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "sections" JSONB NOT NULL,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalesMinutesTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesMeetingMinutes_meetingId_key" ON "SalesMeetingMinutes"("meetingId");

-- CreateIndex
CREATE INDEX "SalesMeetingMinutes_status_idx" ON "SalesMeetingMinutes"("status");

-- CreateIndex
CREATE INDEX "SalesMinutesSection_minutesId_order_idx" ON "SalesMinutesSection"("minutesId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "SalesMinutesPreparer_minutesId_employeeId_key" ON "SalesMinutesPreparer"("minutesId", "employeeId");

-- CreateIndex
CREATE INDEX "SalesMinutesSend_minutesId_sentAt_idx" ON "SalesMinutesSend"("minutesId", "sentAt");

-- AddForeignKey
ALTER TABLE "SalesMeetingMinutes" ADD CONSTRAINT "SalesMeetingMinutes_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "SalesMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMinutesSection" ADD CONSTRAINT "SalesMinutesSection_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "SalesMeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMinutesPreparer" ADD CONSTRAINT "SalesMinutesPreparer_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "SalesMeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMinutesPreparer" ADD CONSTRAINT "SalesMinutesPreparer_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalesMinutesSend" ADD CONSTRAINT "SalesMinutesSend_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "SalesMeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
