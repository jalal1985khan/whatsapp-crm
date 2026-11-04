ALTER TABLE "Workspace"
  ADD COLUMN "failoverMaxAttempts" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "failoverCooldownMinutes" INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN "failoverRequiresApproval" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "FailoverEvent"
  ADD COLUMN "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "approvalReviewedByUserId" TEXT,
  ADD COLUMN "approvalProcessingAt" TIMESTAMP(3);

ALTER TABLE "Workspace"
  ADD CONSTRAINT "Workspace_failoverMaxAttempts_check" CHECK ("failoverMaxAttempts" BETWEEN 0 AND 1),
  ADD CONSTRAINT "Workspace_failoverCooldownMinutes_check" CHECK ("failoverCooldownMinutes" IN (0, 5, 15, 30, 60, 120));

CREATE INDEX "FailoverEvent_pendingApproval_idx"
  ON "FailoverEvent" ("workspaceId", "createdAt")
  WHERE "approvalRequired" = true;
