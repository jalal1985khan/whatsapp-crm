CREATE TABLE "CustomerSegment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" VARCHAR(40) NOT NULL,
  "filters" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerSegment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CustomerSegment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "CustomerSegment_workspaceId_name_key" ON "CustomerSegment"("workspaceId", "name");
CREATE INDEX "CustomerSegment_workspaceId_updatedAt_idx" ON "CustomerSegment"("workspaceId", "updatedAt");
