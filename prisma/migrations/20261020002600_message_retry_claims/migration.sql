CREATE TABLE "MessageRetry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "retryMessageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "idempotencyKey" TEXT NOT NULL,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageRetry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MessageRetry_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageRetry_sourceMessageId_fkey" FOREIGN KEY ("sourceMessageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageRetry_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MessageRetry_retryMessageId_fkey" FOREIGN KEY ("retryMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageRetry_workspaceId_idempotencyKey_key" ON "MessageRetry"("workspaceId", "idempotencyKey");
CREATE UNIQUE INDEX "MessageRetry_workspaceId_sourceMessageId_key" ON "MessageRetry"("workspaceId", "sourceMessageId");
CREATE INDEX "MessageRetry_workspaceId_status_createdAt_idx" ON "MessageRetry"("workspaceId", "status", "createdAt");
