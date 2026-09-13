-- Comments are authored by authenticated users. Employees remain attached
-- when one exists, but Super Admin intentionally has no Employee row.
ALTER TABLE "SalesComment" ADD COLUMN "authorUserId" TEXT;

UPDATE "SalesComment" AS comment
SET "authorUserId" = employee."userId"
FROM "Employee" AS employee
WHERE employee."id" = comment."authorEmployeeId";

ALTER TABLE "SalesComment" ALTER COLUMN "authorUserId" SET NOT NULL;
ALTER TABLE "SalesComment" ALTER COLUMN "authorEmployeeId" DROP NOT NULL;

CREATE INDEX "SalesComment_authorUserId_idx" ON "SalesComment"("authorUserId");

ALTER TABLE "SalesComment"
ADD CONSTRAINT "SalesComment_authorUserId_fkey"
FOREIGN KEY ("authorUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
