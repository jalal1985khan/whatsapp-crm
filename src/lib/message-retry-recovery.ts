import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { getPostgresPool } from "@/lib/postgres-pool";

type Row = QueryResultRow;

export async function recoverStaleMessageRetries(workspaceId: string) {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const stale = await client.query<Row>(`UPDATE "MessageRetry" SET "status"='NEEDS_REVIEW',"errorSummary"='Retry claim expired before its final state was recorded. Reconcile the WhatsApp status before sending again.',"updatedAt"=CURRENT_TIMESTAMP
      WHERE "workspaceId"=$1 AND "status"='PROCESSING' AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '5 minutes' RETURNING "id","sourceMessageId"`, [workspaceId]);
    for (const row of stale.rows) {
      await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,'MESSAGE_RETRY_NEEDS_REVIEW','MESSAGE',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, String(row.sourceMessageId), JSON.stringify({ retryClaimId: String(row.id), reason: "STALE_RETRY_CLAIM" })]);
    }
    await client.query("COMMIT");
    return stale.rows.length;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
