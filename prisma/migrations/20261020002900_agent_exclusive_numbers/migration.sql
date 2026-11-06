-- AlterTable ChannelNumber to support exclusive agent assignment
ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;

-- Add foreign key constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ChannelNumber_assignedUserId_fkey'
  ) THEN
    ALTER TABLE "ChannelNumber" ADD CONSTRAINT "ChannelNumber_assignedUserId_fkey"
      FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ChannelNumber_workspaceId_assignedUserId_idx" ON "ChannelNumber"("workspaceId", "assignedUserId");
