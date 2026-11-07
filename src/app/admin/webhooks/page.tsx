import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { WebhookHealth } from "@/components/webhook-health";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";
type Row = QueryResultRow;

export default async function WebhookHealthPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  let counts: Record<string, number> = {};
  let latestFailed: { id: string; eventType: string; errorSummary: string | null; attemptCount: number; receivedAt: string; nextAttemptAt: string | null } | null = null;
  let setupError = "";
  if (!process.env.DATABASE_URL) setupError = "Configure PostgreSQL to inspect and recover webhook events.";
  else {
    try {
      const pool = getPostgresPool();
      const [stateResult, errorResult] = await Promise.all([
        pool.query<Row>(`SELECT "processingState", COUNT(*)::int AS "count" FROM "WebhookEvent" WHERE "workspaceId" = $1 GROUP BY "processingState"`, [getWorkspaceId()]),
        pool.query<Row>(`SELECT "id", "eventType", "errorSummary", "attemptCount", "receivedAt", "nextAttemptAt" FROM "WebhookEvent" WHERE "workspaceId" = $1 AND "processingState" = 'FAILED' ORDER BY "receivedAt" DESC LIMIT 1`, [getWorkspaceId()]),
      ]);
      counts = Object.fromEntries(stateResult.rows.map((row) => [String(row.processingState), Number(row.count)]));
      const row = errorResult.rows[0];
      if (row) latestFailed = { id: String(row.id), eventType: String(row.eventType), errorSummary: row.errorSummary == null ? null : String(row.errorSummary), attemptCount: Number(row.attemptCount), receivedAt: new Date(String(row.receivedAt)).toISOString(), nextAttemptAt: row.nextAttemptAt == null ? null : new Date(String(row.nextAttemptAt)).toISOString() };
    } catch (error) { setupError = error instanceof Error ? error.message : "Could not load webhook health."; }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Webhook health</h1>
        <p className="mt-1 text-sm text-muted-foreground">Inspect persisted events and retry recoverable webhooks without duplicating messages.</p>
      </div>
      <WebhookHealth initialCounts={counts} initialLatestFailed={latestFailed} setupError={setupError} />
    </div>
  );
}
