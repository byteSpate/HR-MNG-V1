-- CreateEnum
CREATE TYPE "SalesRole" AS ENUM ('SALES_ADMIN', 'SALES_USER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "salesRole" "SalesRole";
