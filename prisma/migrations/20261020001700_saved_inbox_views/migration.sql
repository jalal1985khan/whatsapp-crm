CREATE TABLE "SavedInboxView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "filters" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedInboxView_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SavedInboxView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SavedInboxView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "SavedInboxView_workspaceId_userId_name_key" ON "SavedInboxView"("workspaceId","userId","name");
CREATE INDEX "SavedInboxView_workspaceId_userId_updatedAt_idx" ON "SavedInboxView"("workspaceId","userId","updatedAt");
