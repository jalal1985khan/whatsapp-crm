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

export async function ensureWorkspace(client: { query: (text: string, values?: readonly unknown[]) => Promise<unknown> }) {
  await client.query(
    `INSERT INTO "Workspace" ("id", "name", "updatedAt") VALUES ($1, $2, CURRENT_TIMESTAMP) ON CONFLICT ("id") DO NOTHING`,
    [workspaceId, workspaceName],
  );
  return workspaceId;
}

export function getWorkspaceId() {
  return workspaceId;
}
