CREATE TABLE "AdminAlert" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "dedupeKey" TEXT NOT NULL,
  "severity" TEXT NOT NULL DEFAULT 'WARNING',
  "category" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "targetType" TEXT,
  "targetId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "AdminAlert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AdminAlert_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminAlert_workspaceId_dedupeKey_key" ON "AdminAlert"("workspaceId", "dedupeKey");
CREATE INDEX "AdminAlert_workspaceId_readAt_createdAt_idx" ON "AdminAlert"("workspaceId", "readAt", "createdAt");
