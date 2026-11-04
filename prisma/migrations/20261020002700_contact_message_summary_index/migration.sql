CREATE INDEX "Message_workspaceId_contactId_createdAt_idx"
  ON "Message"("workspaceId", "contactId", "createdAt");
