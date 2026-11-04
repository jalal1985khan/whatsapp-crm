CREATE TABLE "WhatsAppTemplate" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "wabaId" TEXT NOT NULL,
  "metaTemplateId" TEXT,
  "name" TEXT NOT NULL,
  "language" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "components" JSONB NOT NULL DEFAULT '[]',
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppTemplate_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppTemplate_wabaId_name_language_key" ON "WhatsAppTemplate"("wabaId", "name", "language");
CREATE UNIQUE INDEX "WhatsAppTemplate_metaTemplateId_key" ON "WhatsAppTemplate"("metaTemplateId");
CREATE INDEX "WhatsAppTemplate_workspaceId_wabaId_status_idx" ON "WhatsAppTemplate"("workspaceId", "wabaId", "status");
ALTER TABLE "WhatsAppTemplate" ADD CONSTRAINT "WhatsAppTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
