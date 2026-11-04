CREATE TABLE "WhatsAppConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "wabaId" TEXT NOT NULL,
  "businessId" TEXT,
  "businessName" TEXT,
  "accessTokenEncrypted" TEXT NOT NULL,
  "tokenExpiresAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WhatsAppConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WhatsAppConnection_workspaceId_wabaId_key" ON "WhatsAppConnection"("workspaceId","wabaId");
CREATE INDEX "WhatsAppConnection_workspaceId_status_idx" ON "WhatsAppConnection"("workspaceId","status");

ALTER TABLE "ChannelNumber" ADD COLUMN "whatsappConnectionId" TEXT;
ALTER TABLE "ChannelNumber" ADD CONSTRAINT "ChannelNumber_whatsappConnectionId_fkey" FOREIGN KEY ("whatsappConnectionId") REFERENCES "WhatsAppConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "ChannelNumber_whatsappConnectionId_idx" ON "ChannelNumber"("whatsappConnectionId");
