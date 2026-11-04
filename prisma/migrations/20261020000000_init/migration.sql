CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'SUPERVISOR', 'AGENT');
CREATE TYPE "NumberState" AS ENUM ('PENDING', 'ACTIVE', 'DEGRADED', 'PAUSED', 'RESTRICTED', 'DISCONNECTED', 'ARCHIVED');
CREATE TYPE "ConversationState" AS ENUM ('OPEN', 'WAITING', 'RESOLVED');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND', 'INTERNAL');
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'UNKNOWN');
CREATE TYPE "ConsentChannel" AS ENUM ('WHATSAPP');
CREATE TYPE "ConsentStatus" AS ENUM ('OPTED_IN', 'OPTED_OUT');
CREATE TYPE "WebhookProcessingState" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "FailoverOutcome" AS ENUM ('SCHEDULED', 'SENT', 'FAILED', 'SUPPRESSED', 'NEEDS_REVIEW');

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
  "locale" TEXT NOT NULL DEFAULT 'en-IN',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "retentionPolicy" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WorkspaceUser" (
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" "WorkspaceRole" NOT NULL DEFAULT 'AGENT',
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkspaceUser_pkey" PRIMARY KEY ("workspaceId", "userId")
);

CREATE TABLE "ChannelNumber" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "displayName" TEXT,
  "e164Number" TEXT NOT NULL,
  "state" "NumberState" NOT NULL DEFAULT 'PENDING',
  "metaPhoneNumberId" TEXT,
  "metaWabaId" TEXT,
  "qualitySignal" TEXT,
  "connectionRef" TEXT,
  "allowedTeamIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "routingPriority" INTEGER NOT NULL DEFAULT 100,
  "approvedByUserId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "lastStatusEventAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ChannelNumber_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contact" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "displayName" TEXT,
  "primaryPhone" TEXT NOT NULL,
  "email" TEXT,
  "source" TEXT,
  "ownerUserId" TEXT,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "customFields" JSONB NOT NULL DEFAULT '{}',
  "suppressedAt" TIMESTAMP(3),
  "suppressionState" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channelNumberId" TEXT NOT NULL,
  "state" "ConversationState" NOT NULL DEFAULT 'OPEN',
  "assignedUserId" TEXT,
  "assignedTeamId" TEXT,
  "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "serviceWindowExpiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channelNumberId" TEXT NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
  "messageType" TEXT NOT NULL DEFAULT 'text',
  "textBody" TEXT,
  "media" JSONB,
  "templateName" TEXT,
  "platformMessageId" TEXT,
  "idempotencyKey" TEXT,
  "failureCode" TEXT,
  "failureClass" TEXT,
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "readAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "channel" "ConsentChannel" NOT NULL DEFAULT 'WHATSAPP',
  "scope" TEXT NOT NULL,
  "status" "ConsentStatus" NOT NULL,
  "wordingVersion" TEXT,
  "evidenceSource" TEXT NOT NULL,
  "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "capturedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InternalNote" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "authorUserId" TEXT,
  "text" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalNote_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LocalDataImport" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "sourceHash" TEXT,
  "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rowCounts" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "LocalDataImport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactIdentifier" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "normalizedValue" TEXT NOT NULL,
  "verified" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactIdentifier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WebhookEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "channelNumberId" TEXT,
  "platformEventId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "signatureValid" BOOLEAN NOT NULL,
  "rawPayloadRef" TEXT,
  "processingState" "WebhookProcessingState" NOT NULL DEFAULT 'RECEIVED',
  "processedAt" TIMESTAMP(3),
  "errorSummary" TEXT,
  CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RoutingRule" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "conditions" JSONB NOT NULL DEFAULT '{}',
  "channelOrder" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RoutingRule_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FailoverEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "triggeringMessageId" TEXT,
  "fromChannelNumberId" TEXT NOT NULL,
  "toChannelNumberId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "reasonClass" TEXT NOT NULL,
  "sourceEventId" TEXT,
  "outcome" "FailoverOutcome" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FailoverEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT,
  "details" JSONB,
  "before" JSONB,
  "after" JSONB,
  "requestId" TEXT,
  "sourceIp" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "WorkspaceUser_userId_idx" ON "WorkspaceUser"("userId");
CREATE UNIQUE INDEX "ChannelNumber_workspaceId_e164Number_key" ON "ChannelNumber"("workspaceId", "e164Number");
CREATE UNIQUE INDEX "ChannelNumber_metaPhoneNumberId_key" ON "ChannelNumber"("metaPhoneNumberId");
CREATE INDEX "ChannelNumber_workspaceId_state_routingPriority_idx" ON "ChannelNumber"("workspaceId", "state", "routingPriority");
CREATE UNIQUE INDEX "Contact_workspaceId_primaryPhone_key" ON "Contact"("workspaceId", "primaryPhone");
CREATE INDEX "Contact_workspaceId_displayName_idx" ON "Contact"("workspaceId", "displayName");
CREATE UNIQUE INDEX "Conversation_contactId_channelNumberId_key" ON "Conversation"("contactId", "channelNumberId");
CREATE INDEX "Conversation_workspaceId_state_lastMessageAt_idx" ON "Conversation"("workspaceId", "state", "lastMessageAt");
CREATE INDEX "Conversation_assignedUserId_state_lastMessageAt_idx" ON "Conversation"("assignedUserId", "state", "lastMessageAt");
CREATE UNIQUE INDEX "Message_platformMessageId_key" ON "Message"("platformMessageId");
CREATE UNIQUE INDEX "Message_idempotencyKey_key" ON "Message"("idempotencyKey");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_workspaceId_channelNumberId_createdAt_idx" ON "Message"("workspaceId", "channelNumberId", "createdAt");
CREATE INDEX "ConsentRecord_workspaceId_contactId_channel_capturedAt_idx" ON "ConsentRecord"("workspaceId", "contactId", "channel", "capturedAt");
CREATE INDEX "ConsentRecord_contactId_channel_status_idx" ON "ConsentRecord"("contactId", "channel", "status");
CREATE INDEX "InternalNote_workspaceId_contactId_createdAt_idx" ON "InternalNote"("workspaceId", "contactId", "createdAt");
CREATE UNIQUE INDEX "LocalDataImport_workspaceId_key" ON "LocalDataImport"("workspaceId");
CREATE UNIQUE INDEX "ContactIdentifier_contactId_type_normalizedValue_key" ON "ContactIdentifier"("contactId", "type", "normalizedValue");
CREATE INDEX "ContactIdentifier_workspaceId_normalizedValue_type_idx" ON "ContactIdentifier"("workspaceId", "normalizedValue", "type");
CREATE UNIQUE INDEX "WebhookEvent_platformEventId_key" ON "WebhookEvent"("platformEventId");
CREATE INDEX "WebhookEvent_workspaceId_processingState_receivedAt_idx" ON "WebhookEvent"("workspaceId", "processingState", "receivedAt");
CREATE INDEX "WebhookEvent_channelNumberId_receivedAt_idx" ON "WebhookEvent"("channelNumberId", "receivedAt");
CREATE INDEX "RoutingRule_workspaceId_enabled_priority_idx" ON "RoutingRule"("workspaceId", "enabled", "priority");
CREATE INDEX "FailoverEvent_workspaceId_createdAt_idx" ON "FailoverEvent"("workspaceId", "createdAt");
CREATE INDEX "FailoverEvent_conversationId_createdAt_idx" ON "FailoverEvent"("conversationId", "createdAt");
CREATE INDEX "FailoverEvent_fromChannelNumberId_createdAt_idx" ON "FailoverEvent"("fromChannelNumberId", "createdAt");
CREATE INDEX "AuditEvent_workspaceId_createdAt_idx" ON "AuditEvent"("workspaceId", "createdAt");
CREATE INDEX "AuditEvent_actorUserId_idx" ON "AuditEvent"("actorUserId");

ALTER TABLE "WorkspaceUser" ADD CONSTRAINT "WorkspaceUser_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceUser" ADD CONSTRAINT "WorkspaceUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChannelNumber" ADD CONSTRAINT "ChannelNumber_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelNumberId_fkey" FOREIGN KEY ("channelNumberId") REFERENCES "ChannelNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_channelNumberId_fkey" FOREIGN KEY ("channelNumberId") REFERENCES "ChannelNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalNote" ADD CONSTRAINT "InternalNote_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LocalDataImport" ADD CONSTRAINT "LocalDataImport_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactIdentifier" ADD CONSTRAINT "ContactIdentifier_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactIdentifier" ADD CONSTRAINT "ContactIdentifier_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebhookEvent" ADD CONSTRAINT "WebhookEvent_channelNumberId_fkey" FOREIGN KEY ("channelNumberId") REFERENCES "ChannelNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RoutingRule" ADD CONSTRAINT "RoutingRule_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_triggeringMessageId_fkey" FOREIGN KEY ("triggeringMessageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_fromChannelNumberId_fkey" FOREIGN KEY ("fromChannelNumberId") REFERENCES "ChannelNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_toChannelNumberId_fkey" FOREIGN KEY ("toChannelNumberId") REFERENCES "ChannelNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FailoverEvent" ADD CONSTRAINT "FailoverEvent_sourceEventId_fkey" FOREIGN KEY ("sourceEventId") REFERENCES "WebhookEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
