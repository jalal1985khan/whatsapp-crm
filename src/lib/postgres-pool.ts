import "server-only";

import { Pool } from "pg";

const workspaceId = process.env.CRM_WORKSPACE_ID || "default-workspace";
const workspaceName = process.env.CRM_WORKSPACE_NAME || "WhatsApp CRM";
const globalPool = globalThis as typeof globalThis & { __whatsappCrmPool?: Pool };

export function getPostgresPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for PostgreSQL storage.");
  globalPool.__whatsappCrmPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
  return globalPool.__whatsappCrmPool;
}

let schemaEnsured = false;

export async function ensureWorkspace(client: { query: (text: string, values?: readonly unknown[]) => Promise<unknown> }) {
  await client.query(
    `INSERT INTO "Workspace" ("id", "name", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
    [workspaceId, workspaceName],
  );

  if (!schemaEnsured) {
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "TwilioAccount" (
          "id" TEXT NOT NULL,
          "workspaceId" TEXT NOT NULL,
          "friendlyName" TEXT NOT NULL,
          "accountSid" TEXT NOT NULL,
          "authTokenEncrypted" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT "TwilioAccount_pkey" PRIMARY KEY ("id")
        );
        ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'TWILIO';
        ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAccountId" TEXT;
        ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAccountSid" TEXT;
        ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "twilioAuthTokenEncrypted" TEXT;
        ALTER TABLE "ChannelNumber" ADD COLUMN IF NOT EXISTS "assignedUserId" TEXT;
        CREATE INDEX IF NOT EXISTS "ChannelNumber_workspaceId_assignedUserId_idx" ON "ChannelNumber"("workspaceId", "assignedUserId");
        CREATE INDEX IF NOT EXISTS "ChannelNumber_workspaceId_provider_idx" ON "ChannelNumber"("workspaceId", "provider");
      `);
      schemaEnsured = true;
    } catch {
      // Continue without failing if query fails or is concurrent
    }
  }

  return workspaceId;
}

export function getWorkspaceId() {
  return workspaceId;
}
