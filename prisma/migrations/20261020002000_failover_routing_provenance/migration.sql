ALTER TABLE "FailoverEvent"
  ADD COLUMN "routingRuleId" TEXT,
  ADD COLUMN "routingRuleVersion" INTEGER;

CREATE INDEX "FailoverEvent_workspaceId_routingRuleId_createdAt_idx"
  ON "FailoverEvent" ("workspaceId", "routingRuleId", "createdAt");
