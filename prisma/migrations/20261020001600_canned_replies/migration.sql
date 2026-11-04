CREATE TABLE "CannedReply" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortcut" TEXT,
    "body" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 100,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CannedReply_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "CannedReply_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CannedReply_workspaceId_shortcut_active_key" ON "CannedReply"("workspaceId", "shortcut") WHERE "shortcut" IS NOT NULL AND "isActive" = true;
CREATE INDEX "CannedReply_workspaceId_active_sortOrder_idx" ON "CannedReply"("workspaceId", "isActive", "sortOrder");
