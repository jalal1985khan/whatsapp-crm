import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
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

  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Admin</span></div><nav className="flex gap-4 text-sm text-muted-foreground"><Link href="/admin/numbers" className="hover:text-foreground">Numbers</Link><Link href="/admin/templates" className="hover:text-foreground">Templates</Link><Link href="/admin/alerts" className="hover:text-foreground">Alerts</Link><Link href="/admin/privacy" className="hover:text-foreground">Privacy</Link><Link href="/" className="hover:text-foreground">Inbox</Link></nav></header>
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8"><Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to channels</Link><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Webhook health</h1><p className="mt-1 text-sm text-muted-foreground">Inspect persisted Meta events and retry recoverable events without duplicating inbound messages.</p></div><WebhookHealth initialCounts={counts} initialLatestFailed={latestFailed} setupError={setupError} /></div>
  </main>;
}
