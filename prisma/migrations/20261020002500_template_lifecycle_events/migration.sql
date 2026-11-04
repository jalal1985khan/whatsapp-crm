ALTER TABLE "WhatsAppTemplate"
  ADD COLUMN "statusReason" TEXT,
  ADD COLUMN "statusUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "qualityScore" TEXT,
  ADD COLUMN "previousQualityScore" TEXT,
  ADD COLUMN "qualityUpdatedAt" TIMESTAMP(3);

UPDATE "WhatsAppTemplate" SET "statusUpdatedAt" = "syncedAt" WHERE "statusUpdatedAt" IS NULL;
