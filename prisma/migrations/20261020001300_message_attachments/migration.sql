CREATE TABLE "MessageAttachment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "providerMediaId" TEXT,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "sha256" TEXT,
  "encryptedContent" BYTEA,
  "storageStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "errorSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MessageAttachment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MessageAttachment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "MessageAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MessageAttachment_messageId_key" ON "MessageAttachment"("messageId");
CREATE INDEX "MessageAttachment_workspaceId_storageStatus_idx" ON "MessageAttachment"("workspaceId","storageStatus");
CREATE INDEX "MessageAttachment_providerMediaId_idx" ON "MessageAttachment"("providerMediaId");

INSERT INTO "MessageAttachment" ("id","workspaceId","messageId","providerMediaId","filename","mimeType","sizeBytes","sha256","storageStatus","attemptCount","nextAttemptAt","createdAt","updatedAt")
SELECT 'attachment-' || m."id",m."workspaceId",m."id",COALESCE(m."media"->>'mediaId',m."media"->m."messageType"->>'id'),
  COALESCE(NULLIF(m."media"->>'filename',''),NULLIF(m."media"->m."messageType"->>'filename',''),m."messageType" || '-' || m."id"),
  COALESCE(NULLIF(m."media"->>'mimeType',''),NULLIF(m."media"->m."messageType"->>'mime_type',''),'application/octet-stream'),
  CASE WHEN m."media"->>'size' ~ '^\d+$' THEN (m."media"->>'size')::bigint ELSE 0 END,
  COALESCE(m."media"->m."messageType"->>'sha256',m."media"->>'sha256'),'PENDING',0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP
FROM "Message" m
WHERE m."media" IS NOT NULL AND COALESCE(m."media"->>'mediaId',m."media"->m."messageType"->>'id') IS NOT NULL
ON CONFLICT ("messageId") DO NOTHING;
