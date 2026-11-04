import { getCrmSnapshot } from "@/lib/crm-store";
import { NumberAdmin, type MetaConnectionCheck } from "@/components/number-admin";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";

export default async function NumbersPage() {
  const snapshot = await getCrmSnapshot();
  let autoFailoverEnabled = false;
  let failoverMaxAttempts = 1;
  let failoverCooldownMinutes = 60;
  let failoverRequiresApproval = false;
  let failoverNotificationTemplateId: string | null = null;
  let connectedAccountAvailable = false;
  const initialConnectionChecks: Record<string, MetaConnectionCheck> = {};
  if (process.env.DATABASE_URL) {
    try {
      const result = await getPostgresPool().query<QueryResultRow>(`SELECT "autoFailoverEnabled", "failoverNotificationTemplateId", "failoverMaxAttempts", "failoverCooldownMinutes", "failoverRequiresApproval" FROM "Workspace" WHERE "id" = $1`, [getWorkspaceId()]);
      autoFailoverEnabled = Boolean(result.rows[0]?.autoFailoverEnabled);
      failoverMaxAttempts = Number(result.rows[0]?.failoverMaxAttempts ?? 1);
      failoverCooldownMinutes = Number(result.rows[0]?.failoverCooldownMinutes ?? 60);
      failoverRequiresApproval = Boolean(result.rows[0]?.failoverRequiresApproval);
      failoverNotificationTemplateId = result.rows[0]?.failoverNotificationTemplateId == null ? null : String(result.rows[0].failoverNotificationTemplateId);
      const connections = await getPostgresPool().query<QueryResultRow>(`SELECT 1 FROM "WhatsAppConnection" WHERE "workspaceId"=$1 AND "status"='ACTIVE' AND ("tokenExpiresAt" IS NULL OR "tokenExpiresAt">CURRENT_TIMESTAMP) LIMIT 1`, [getWorkspaceId()]);
      connectedAccountAvailable = connections.rows.length > 0;
      const checks = await getPostgresPool().query<QueryResultRow>(`SELECT DISTINCT ON ("targetId") "targetId","details","createdAt" FROM "AuditEvent"
        WHERE "workspaceId"=$1 AND "targetType"='CHANNEL_NUMBER' AND "action" IN ('CHANNEL_NUMBER_CONNECTION_CHECKED','CHANNEL_NUMBER_ACTIVATION_CHECKED')
        ORDER BY "targetId","createdAt" DESC,"id" DESC`, [getWorkspaceId()]);
      for (const row of checks.rows) {
        const details = row.details && typeof row.details === "object" ? row.details as Record<string, unknown> : {};
        initialConnectionChecks[String(row.targetId)] = {
          outcome: details.outcome === "PASSED" ? "PASSED" : "FAILED",
          checkedAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(String(row.createdAt)).toISOString(),
          error: typeof details.error === "string" ? details.error : details.outcome === "PASSED" ? null : "Meta check failed. Run the read-only check again for details.",
          verifiedName: typeof details.verifiedName === "string" ? details.verifiedName : null,
          displayNumber: null,
          numberMatches: typeof details.numberMatches === "boolean" ? details.numberMatches : null,
          qualityRating: typeof details.qualityRating === "string" ? details.qualityRating : null,
        };
      }
    } catch { /* Migration or database setup may not be complete yet. */ }
  }
  return <NumberAdmin initialNumbers={snapshot.numbers} initialConnectionChecks={initialConnectionChecks} liveSendingEnabled={Boolean(process.env.DATABASE_URL && (process.env.META_ACCESS_TOKEN || connectedAccountAvailable))} initialAutoFailoverEnabled={autoFailoverEnabled} initialNotificationTemplateId={failoverNotificationTemplateId} initialFailoverMaxAttempts={failoverMaxAttempts} initialFailoverCooldownMinutes={failoverCooldownMinutes} initialFailoverRequiresApproval={failoverRequiresApproval} />;
}
