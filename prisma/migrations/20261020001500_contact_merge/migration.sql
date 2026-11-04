ALTER TABLE "Contact" ADD COLUMN "mergedIntoContactId" TEXT;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_mergedIntoContactId_fkey" FOREIGN KEY ("mergedIntoContactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Contact_workspaceId_mergedIntoContactId_idx" ON "Contact"("workspaceId","mergedIntoContactId");
