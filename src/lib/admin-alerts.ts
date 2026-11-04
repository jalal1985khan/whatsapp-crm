import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getWorkspaceId } from "@/lib/postgres-pool";

export type AlertInput = {
  workspaceId: string;
  dedupeKey: string;
  severity?: "INFO" | "WARNING" | "CRITICAL";
  category: string;
  title: string;
  message: string;
  targetType?: string;
  targetId?: string | null;
};

export async function createAdminAlert(client: PoolClient, alert: AlertInput) {
  await client.query(`INSERT INTO "AdminAlert" ("id","workspaceId","dedupeKey","severity","category","title","message","targetType","targetId","createdAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP)
    ON CONFLICT ("workspaceId","dedupeKey") DO NOTHING`, [randomUUID(), alert.workspaceId, alert.dedupeKey.slice(0, 240), alert.severity ?? "WARNING", alert.category.slice(0, 80), alert.title.slice(0, 200), alert.message.slice(0, 1000), alert.targetType ?? null, alert.targetId ?? null]);
}

export async function refreshConnectionExpiryAlerts(client: PoolClient, workspaceId = getWorkspaceId()) {
  const result = await client.query<{ id: string; wabaId: string; businessName: string | null; tokenExpiresAt: Date | string; senderLabels: string | null }>(`SELECT c."id",c."wabaId",c."businessName",c."tokenExpiresAt",
      (SELECT string_agg(n."label", ', ' ORDER BY n."routingPriority") FROM "ChannelNumber" n WHERE n."workspaceId"=c."workspaceId" AND n."metaWabaId"=c."wabaId") AS "senderLabels"
    FROM "WhatsAppConnection" c WHERE c."workspaceId"=$1 AND c."status"='ACTIVE' AND c."tokenExpiresAt" IS NOT NULL AND c."tokenExpiresAt"<=CURRENT_TIMESTAMP+INTERVAL '7 days'`, [workspaceId]);
  for (const row of result.rows) {
    const expiresAt = new Date(row.tokenExpiresAt);
    if (!Number.isFinite(expiresAt.getTime())) continue;
    const expired = expiresAt.getTime() <= Date.now();
    const expiryKey = expiresAt.toISOString().replace(/[^0-9TZ]/g, "");
    await createAdminAlert(client, {
      workspaceId,
      dedupeKey: `meta-token-expiry:${row.id}:${expiryKey}`,
      severity: expired ? "CRITICAL" : "WARNING",
      category: "INTEGRATION",
      title: expired ? "WhatsApp connection authorization expired" : "WhatsApp connection authorization expires soon",
      message: `${row.businessName?.trim() || "A connected WhatsApp business account"}${row.senderLabels ? ` (CRM senders: ${row.senderLabels})` : " (no CRM senders currently mapped)"} ${expired ? "has an expired Meta authorization and may be unable to send or sync." : `has a Meta authorization that expires on ${expiresAt.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC. Reconnect before then to avoid interruption.`} Reconnect it from Admin → WhatsApp numbers. Credential values are never included in this alert.`,
      targetType: "WHATSAPP_BUSINESS_ACCOUNT",
      targetId: row.wabaId,
    });
  }
  return result.rowCount ?? result.rows.length;
}
