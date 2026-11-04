ALTER TABLE "Workspace"
  ADD COLUMN "emailAlertsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "adminAlertEmails" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AdminAlert"
  ADD COLUMN "emailSentAt" TIMESTAMP(3),
  ADD COLUMN "emailAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "emailLastError" TEXT;

CREATE INDEX "AdminAlert_emailSentAt_emailAttempts_createdAt_idx" ON "AdminAlert"("emailSentAt", "emailAttempts", "createdAt");
ALTER TABLE "AdminAlert" ADD COLUMN "emailNextAttemptAt" TIMESTAMP(3);
DROP INDEX "AdminAlert_emailSentAt_emailAttempts_createdAt_idx";
CREATE INDEX "AdminAlert_emailSentAt_emailNextAttemptAt_emailAttempts_createdAt_idx" ON "AdminAlert"("emailSentAt", "emailNextAttemptAt", "emailAttempts", "createdAt");
ALTER TABLE "AdminAlert" ADD COLUMN "emailRecipients" TEXT[];
