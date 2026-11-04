import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;

function iso(value: unknown) { return value == null ? null : new Date(String(value)).toISOString(); }
function maskNumber(value: unknown) {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits ? `${digits.length > 2 ? "+" : ""}${"•".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : null;
}

export async function GET(request: Request) {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Diagnostics require PostgreSQL." }, { status: 503 });
  try {
    const pool = getPostgresPool();
    const workspaceId = getWorkspaceId();
    const [numberRows, connectionRows, webhookCounts, failedEvents, messageCounts, alerts, failovers, auditActions, mediaCounts, retryStates, retryReviews] = await Promise.all([
      pool.query<Row>(`SELECT "label","e164Number","state","qualitySignal","lastStatusEventAt" FROM "ChannelNumber" WHERE "workspaceId"=$1 ORDER BY "routingPriority","createdAt"`, [workspaceId]),
      pool.query<Row>(`SELECT "status",COUNT(*)::int AS "count",COUNT(*) FILTER (WHERE "tokenExpiresAt" IS NOT NULL AND "tokenExpiresAt"<=CURRENT_TIMESTAMP+INTERVAL '7 days')::int AS "expiresWithin7Days" FROM "WhatsAppConnection" WHERE "workspaceId"=$1 GROUP BY "status"`, [workspaceId]),
      pool.query<Row>(`SELECT "processingState",COUNT(*)::int AS "count",MAX("receivedAt") AS "latestReceivedAt" FROM "WebhookEvent" WHERE "workspaceId"=$1 GROUP BY "processingState"`, [workspaceId]),
      pool.query<Row>(`SELECT "eventType","attemptCount","receivedAt" FROM "WebhookEvent" WHERE "workspaceId"=$1 AND "processingState"='FAILED' ORDER BY "receivedAt" DESC LIMIT 10`, [workspaceId]),
      pool.query<Row>(`SELECT "status",COUNT(*)::int AS "count",COUNT(*) FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "last24Hours" FROM "Message" WHERE "workspaceId"=$1 GROUP BY "status"`, [workspaceId]),
      pool.query<Row>(`SELECT "severity","category","createdAt" FROM "AdminAlert" WHERE "workspaceId"=$1 ORDER BY "createdAt" DESC LIMIT 20`, [workspaceId]),
      pool.query<Row>(`SELECT f."reasonClass",f."providerErrorCode",f."providerErrorSubcode",f."httpStatus",f."routingRuleId",f."routingRuleVersion",f."outcome",f."createdAt",src."label" AS "fromLabel",src."e164Number" AS "fromNumber",dst."label" AS "toLabel",dst."e164Number" AS "toNumber" FROM "FailoverEvent" f JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId" WHERE f."workspaceId"=$1 ORDER BY f."createdAt" DESC LIMIT 20`, [workspaceId]),
      pool.query<Row>(`SELECT "action","targetType","createdAt" FROM "AuditEvent" WHERE "workspaceId"=$1 AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '14 days' ORDER BY "createdAt" DESC LIMIT 30`, [workspaceId]),
      pool.query<Row>(`SELECT "storageStatus",COUNT(*)::int AS "count" FROM "MessageAttachment" WHERE "workspaceId"=$1 GROUP BY "storageStatus"`, [workspaceId]),
      pool.query<Row>(`SELECT "status",COUNT(*)::int AS "count",COUNT(*) FILTER (WHERE "status"='PROCESSING' AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '5 minutes')::int AS "staleProcessing" FROM "MessageRetry" WHERE "workspaceId"=$1 GROUP BY "status"`, [workspaceId]),
      pool.query<Row>(`SELECT "status","createdAt","updatedAt" FROM "MessageRetry" WHERE "workspaceId"=$1 AND ("status"='NEEDS_REVIEW' OR ("status"='PROCESSING' AND "updatedAt"<CURRENT_TIMESTAMP-INTERVAL '5 minutes')) ORDER BY "updatedAt" DESC LIMIT 10`, [workspaceId]),
    ]);

    const retryReviewItems = retryReviews.rows.map((row) => ({ status: String(row.status) === "PROCESSING" ? "NEEDS_REVIEW" : String(row.status), createdAt: iso(row.createdAt), updatedAt: iso(row.updatedAt) }));

    const incidents = [
      ...alerts.rows.map((row) => ({ kind: "ALERT", severity: String(row.severity), category: String(row.category), summary: `${String(row.category).replaceAll("_", " ")} alert`, occurredAt: iso(row.createdAt) })),
      ...failedEvents.rows.map((row) => ({ kind: "WEBHOOK_FAILURE", severity: "CRITICAL", category: "WEBHOOK", summary: `${String(row.eventType)} event failed after ${Number(row.attemptCount)} attempt${Number(row.attemptCount) === 1 ? "" : "s"}`, occurredAt: iso(row.receivedAt) })),
      ...failovers.rows.map((row) => ({ kind: "FAILOVER", severity: String(row.outcome) === "FAILED" ? "CRITICAL" : "WARNING", category: "FAILOVER", summary: `${String(row.fromLabel)} to ${String(row.toLabel)} · ${String(row.reasonClass).replaceAll("_", " ")} · ${String(row.outcome).replaceAll("_", " ")}`, occurredAt: iso(row.createdAt) })),
      ...retryReviewItems.map((row) => ({ kind: "MESSAGE_RETRY", severity: "WARNING", category: "MESSAGE_RETRY", summary: "Outbound retry needs delivery-status reconciliation", occurredAt: row.updatedAt })),
      ...auditActions.rows.map((row) => ({ kind: "ADMIN_ACTION", severity: "INFO", category: String(row.targetType), summary: String(row.action).replaceAll("_", " ").toLowerCase(), occurredAt: iso(row.createdAt) })),
    ].filter((item) => item.occurredAt).sort((a, b) => String(b.occurredAt).localeCompare(String(a.occurredAt))).slice(0, 40);

    const bundle = {
      generatedAt: new Date().toISOString(),
      scope: "Operations metadata only. Customer names, phone numbers, message text, raw webhook payloads, credentials, tokens, and secret values are excluded.",
      configuration: { databaseConfigured: true, metaAppConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET), webhookVerificationConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN), webhookRecoveryConfigured: Boolean(process.env.WEBHOOK_RECOVERY_SECRET), emailAlertsConfigured: Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM) },
      numbers: numberRows.rows.map((row) => ({ label: String(row.label), number: maskNumber(row.e164Number), state: String(row.state), qualitySignal: row.qualitySignal == null ? null : String(row.qualitySignal), lastStatusEventAt: iso(row.lastStatusEventAt) })),
      connections: connectionRows.rows.map((row) => ({ status: String(row.status), count: Number(row.count), tokenExpiresWithin7Days: Number(row.expiresWithin7Days) })),
      webhooks: { byState: Object.fromEntries(webhookCounts.rows.map((row) => [String(row.processingState), Number(row.count)])), latestReceivedAt: iso(webhookCounts.rows.reduce<unknown>((latest, row) => !latest || (row.latestReceivedAt && new Date(String(row.latestReceivedAt)) > new Date(String(latest))) ? row.latestReceivedAt : latest, null)), recentFailures: failedEvents.rows.map((row) => ({ eventType: String(row.eventType), attempts: Number(row.attemptCount), receivedAt: iso(row.receivedAt) })) },
      messages: Object.fromEntries(messageCounts.rows.map((row) => [String(row.status), { total: Number(row.count), last24Hours: Number(row.last24Hours) }])),
      mediaArchives: Object.fromEntries(mediaCounts.rows.map((row) => [String(row.storageStatus), Number(row.count)])),
      retryClaims: { byStatus: Object.fromEntries(retryStates.rows.map((row) => [String(row.status), { count: Number(row.count), staleProcessing: Number(row.staleProcessing) }])), reviewItems: retryReviewItems },
      incidents,
    };
    const download = new URL(request.url).searchParams.get("download") === "1";
    if (download) return new Response(JSON.stringify(bundle, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="relay-crm-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
    return NextResponse.json({ incidents, retryClaims: bundle.retryClaims, generatedAt: bundle.generatedAt }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not assemble diagnostics. Check database connectivity and schema migrations." }, { status: 503 });
  }
}
