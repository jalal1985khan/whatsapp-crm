ALTER TABLE "Workspace" ADD COLUMN "autoFailoverEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Workspace" ADD COLUMN "failoverNotificationTemplateId" TEXT;
