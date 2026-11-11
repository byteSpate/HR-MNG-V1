-- DropForeignKey
ALTER TABLE "WeeklyReportCopy" DROP CONSTRAINT "WeeklyReportCopy_weeklyReportId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyAccountNote" DROP CONSTRAINT "WeeklyAccountNote_weeklyReportId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyAccountNote" DROP CONSTRAINT "WeeklyAccountNote_salesAccountId_fkey";

-- DropForeignKey
ALTER TABLE "WeeklyOtherWork" DROP CONSTRAINT "WeeklyOtherWork_weeklyReportId_fkey";

-- DropTable
DROP TABLE "WeeklyReportCopy";

-- DropTable
DROP TABLE "WeeklyAccountNote";

-- DropTable
DROP TABLE "WeeklyOtherWork";
