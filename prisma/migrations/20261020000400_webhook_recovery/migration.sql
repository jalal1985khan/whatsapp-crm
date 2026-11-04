ALTER TABLE "WebhookEvent" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "WebhookEvent" ADD COLUMN "processingStartedAt" TIMESTAMP(3);
ALTER TABLE "WebhookEvent" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);
UPDATE "WebhookEvent" SET "processingStartedAt" = "receivedAt"
  WHERE "processingState" = 'PROCESSING' AND "processingStartedAt" IS NULL;
UPDATE "WebhookEvent" SET "nextAttemptAt" = "receivedAt"
  WHERE "processingState" IN ('RECEIVED','FAILED') AND "nextAttemptAt" IS NULL;
CREATE INDEX "WebhookEvent_recovery_due_idx" ON "WebhookEvent"("processingState", "nextAttemptAt", "receivedAt");
