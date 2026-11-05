-- CreateTable
CREATE TABLE IF NOT EXISTS "TwilioAccount" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "friendlyName" TEXT NOT NULL,
  "accountSid" TEXT NOT NULL,
  "authTokenEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TwilioAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "TwilioAccount_workspaceId_accountSid_key" UNIQUE ("workspaceId", "accountSid"),
  CONSTRAINT "TwilioAccount_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlterTable ChannelNumber to support Twilio provider and credentials
ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'TWILIO';
ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAccountId" TEXT;
ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAccountSid" TEXT;
ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAuthTokenEncrypted" TEXT;

-- Add foreign key constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChannelNumber_twilioAccountId_fkey'
  ) THEN
    ALTER TABLE "ChannelNumber" ADD CONSTRAINT "ChannelNumber_twilioAccountId_fkey"
      FOREIGN KEY ("twilioAccountId") REFERENCES "TwilioAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChannelNumber_workspaceId_provider_idx" ON "ChannelNumber"("workspaceId", "provider");
CREATE INDEX IF NOT EXISTS "TwilioAccount_workspaceId_idx" ON "TwilioAccount"("workspaceId");

