import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";
import { AdminSidebarLayout } from "@/components/admin-sidebar-layout";
import {
  DashboardAnalytics,
  type DailyDataPoint,
  type MemberActivity,
  type ChannelNumberSummary,
} from "@/components/dashboard-analytics";

export const dynamic = "force-dynamic";

const emptyResponseStats: { answered: number; medianMinutes: number | null; p95Minutes: number | null } = { answered: 0, medianMinutes: null, p95Minutes: null };
const emptyQueueStats: { awaiting: number; under15m: number; under1h: number; under4h: number; over4h: number; oldestMinutes: number | null } = { awaiting: 0, under15m: 0, under1h: 0, under4h: 0, over4h: 0, oldestMinutes: null };
const emptyOperations: { pendingWebhooks: number; oldestWebhookMinutes: number | null; outbound24Hours: number; confirmed24Hours: number; failed24Hours: number; failureRate: number | null; recentFailovers: { from: string; to: string; outcome: string; reason: string; createdAt: string }[] } = { pendingWebhooks: 0, oldestWebhookMinutes: null, outbound24Hours: 0, confirmed24Hours: 0, failed24Hours: 0, failureRate: null, recentFailovers: [] };

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "Owner" && session.role !== "Admin") redirect("/");

  const isPostgres = Boolean(process.env.DATABASE_URL);
  let dataError: string | null = isPostgres ? null : "The persistent CRM database is not configured.";
  let totalCustomers = 0;
  let totalConversations = 0;
  let totalMessages = 0;
  let deliveryRate: number | null = null;
  let responseStats: typeof emptyResponseStats | null = null;
  let queueStats: typeof emptyQueueStats | null = null;
  let operations: typeof emptyOperations | null = null;
  let chartData: DailyDataPoint[] = [];
  let members: MemberActivity[] = [];
  let numbers: ChannelNumberSummary[] = [];

  if (isPostgres) {
    try {
      const pool = getPostgresPool();
      const workspaceId = getWorkspaceId();
      const [summaryResult, responseResult, queueResult, webhookResult, deliveryResult, failoverResult, dailyResult, memberResult, numbersResult] = await Promise.all([
        pool.query<QueryResultRow>(`SELECT (SELECT COUNT(*)::int FROM "Contact" WHERE "workspaceId"=$1 AND "mergedIntoContactId" IS NULL) AS customers, (SELECT COUNT(*)::int FROM "Conversation" WHERE "workspaceId"=$1 AND "state" IN ('OPEN','WAITING')) AS conversations, (SELECT COUNT(*)::int FROM "Message" WHERE "workspaceId"=$1 AND "direction" IN ('INBOUND','OUTBOUND')) AS messages`, [workspaceId]),
        pool.query<QueryResultRow>(`WITH first_inbound AS (SELECT m."conversationId",MIN(m."createdAt") AS first_at FROM "Message" m WHERE m."workspaceId"=$1 AND m."direction"='INBOUND' AND m."createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY m."conversationId"), first_reply AS (SELECT i."conversationId",EXTRACT(EPOCH FROM (MIN(o."createdAt")-i.first_at))/60.0 AS minutes FROM first_inbound i JOIN "Message" o ON o."workspaceId"=$1 AND o."conversationId"=i."conversationId" AND o."direction"='OUTBOUND' AND o."status" IN ('SENT','DELIVERED','READ') AND o."createdAt">=i.first_at GROUP BY i."conversationId",i.first_at) SELECT COUNT(*)::int AS answered,PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY minutes) AS median,PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY minutes) AS p95 FROM first_reply`, [workspaceId]),
        pool.query<QueryResultRow>(`WITH recent AS (SELECT m."conversationId",MAX(m."createdAt") FILTER (WHERE m."direction"='INBOUND') AS inbound_at,MAX(m."createdAt") FILTER (WHERE m."direction"='OUTBOUND' AND m."status" IN ('SENT','DELIVERED','READ')) AS outbound_at FROM "Message" m JOIN "Conversation" c ON c."id"=m."conversationId" AND c."state" IN ('OPEN','WAITING') WHERE m."workspaceId"=$1 GROUP BY m."conversationId"), waiting AS (SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-inbound_at))/60.0 AS minutes FROM recent WHERE inbound_at IS NOT NULL AND (outbound_at IS NULL OR inbound_at>outbound_at)) SELECT COUNT(*)::int AS awaiting,COUNT(*) FILTER (WHERE minutes<15)::int AS under15m,COUNT(*) FILTER (WHERE minutes>=15 AND minutes<60)::int AS under1h,COUNT(*) FILTER (WHERE minutes>=60 AND minutes<240)::int AS under4h,COUNT(*) FILTER (WHERE minutes>=240)::int AS over4h,MAX(minutes) AS oldest FROM waiting`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT COUNT(*) FILTER (WHERE "processingState" IN ('RECEIVED','PROCESSING','FAILED'))::int AS pending,EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN("receivedAt") FILTER (WHERE "processingState" IN ('RECEIVED','PROCESSING','FAILED'))))/60.0 AS oldest FROM "WebhookEvent" WHERE "workspaceId"=$1`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT COUNT(*)::int AS outbound,COUNT(*) FILTER (WHERE "status" IN ('DELIVERED','READ'))::int AS confirmed,COUNT(*) FILTER (WHERE "status"='FAILED')::int AS failed FROM "Message" WHERE "workspaceId"=$1 AND "direction"='OUTBOUND' AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours'`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT src."label" AS from_label,dst."label" AS to_label,f."outcome",f."reasonClass",f."createdAt" FROM "FailoverEvent" f JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId" WHERE f."workspaceId"=$1 ORDER BY f."createdAt" DESC LIMIT 5`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT TO_CHAR("createdAt",'YYYY-MM-DD') AS date_key,TO_CHAR("createdAt",'Dy') AS day_label,COUNT(*) FILTER (WHERE "direction"='INBOUND')::int AS inbound,COUNT(*) FILTER (WHERE "direction"='OUTBOUND')::int AS outbound,COUNT(*) FILTER (WHERE "direction"='OUTBOUND' AND "status" IN ('DELIVERED','READ'))::int AS delivered FROM "Message" WHERE "workspaceId"=$1 AND "direction" IN ('INBOUND','OUTBOUND') AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days' GROUP BY 1,2 ORDER BY 1`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT u."id",u."name",u."email",wu."role",COALESCE(t."name",'Unassigned') AS team,COUNT(DISTINCT c."id") FILTER (WHERE c."state" IN ('OPEN','WAITING'))::int AS assigned,COUNT(DISTINCT c."id") FILTER (WHERE c."state" IN ('OPEN','WAITING') AND last_inbound.at IS NOT NULL AND (last_outbound.at IS NULL OR last_inbound.at>last_outbound.at))::int AS awaiting FROM "User" u JOIN "WorkspaceUser" wu ON wu."userId"=u."id" AND wu."workspaceId"=$1 LEFT JOIN "Conversation" c ON c."assignedUserId"=u."id" AND c."workspaceId"=$1 LEFT JOIN "Team" t ON t."id"=c."assignedTeamId" LEFT JOIN LATERAL (SELECT MAX(m."createdAt") AS at FROM "Message" m WHERE m."conversationId"=c."id" AND m."direction"='INBOUND') last_inbound ON TRUE LEFT JOIN LATERAL (SELECT MAX(m."createdAt") AS at FROM "Message" m WHERE m."conversationId"=c."id" AND m."direction"='OUTBOUND' AND m."status" IN ('SENT','DELIVERED','READ')) last_outbound ON TRUE WHERE u."active"=TRUE GROUP BY u."id",u."name",u."email",wu."role",t."name" ORDER BY u."name"`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT "id","label","e164Number","state","provider" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "state"<>'ARCHIVED' ORDER BY "routingPriority","label"`, [workspaceId]),
      ]);

      const summary = summaryResult.rows[0] ?? {};
      totalCustomers = Number(summary.customers ?? 0);
      totalConversations = Number(summary.conversations ?? 0);
      totalMessages = Number(summary.messages ?? 0);
      const response = responseResult.rows[0] ?? {};
      responseStats = { answered: Number(response.answered ?? 0), medianMinutes: response.median == null ? null : Number(response.median), p95Minutes: response.p95 == null ? null : Number(response.p95) };
      const queue = queueResult.rows[0] ?? {};
      queueStats = { awaiting: Number(queue.awaiting ?? 0), under15m: Number(queue.under15m ?? 0), under1h: Number(queue.under1h ?? 0), under4h: Number(queue.under4h ?? 0), over4h: Number(queue.over4h ?? 0), oldestMinutes: queue.oldest == null ? null : Number(queue.oldest) };
      const webhook = webhookResult.rows[0] ?? {};
      const delivery = deliveryResult.rows[0] ?? {};
      const outbound24Hours = Number(delivery.outbound ?? 0);
      const confirmed24Hours = Number(delivery.confirmed ?? 0);
      const failed24Hours = Number(delivery.failed ?? 0);
      operations = { pendingWebhooks: Number(webhook.pending ?? 0), oldestWebhookMinutes: webhook.oldest == null ? null : Number(webhook.oldest), outbound24Hours, confirmed24Hours, failed24Hours, failureRate: outbound24Hours ? failed24Hours / outbound24Hours * 100 : null, recentFailovers: failoverResult.rows.map((row) => ({ from: String(row.from_label), to: String(row.to_label), outcome: String(row.outcome), reason: String(row.reasonClass ?? "").replaceAll("_", " ").toLowerCase(), createdAt: new Date(row.createdAt as string).toISOString() })) };
      chartData = dailyResult.rows.map((row) => ({ date: String(row.date_key), dayLabel: String(row.day_label), inbound: Number(row.inbound ?? 0), outbound: Number(row.outbound ?? 0), deliveryRate: Number(row.outbound) > 0 ? Number(row.delivered) / Number(row.outbound) * 100 : 100 }));
      const outbound30d = chartData.reduce((sum, point) => sum + point.outbound, 0);
      const delivered30d = dailyResult.rows.reduce((sum, row) => sum + Number(row.delivered ?? 0), 0);
      deliveryRate = outbound30d ? delivered30d / outbound30d * 100 : null;
      members = memberResult.rows.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), role: String(row.role), team: String(row.team), assignedConversations: Number(row.assigned ?? 0), awaitingReply: Number(row.awaiting ?? 0) }));
      numbers = numbersResult.rows.map((row) => ({ id: String(row.id), label: String(row.label), number: String(row.e164Number), state: String(row.state), provider: String(row.provider) }));
    } catch (error) {
      console.error("Unable to load WhatsApp report data", error);
      dataError = "The CRM database could not return report data. Check the database connection and schema, then refresh.";
    }
  }

  return <AdminSidebarLayout user={{ name: session.name, email: session.email, role: session.role }}><div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8"><DashboardAnalytics isPostgres={isPostgres && !dataError} dataError={dataError} totalCustomers={totalCustomers} totalConversations={totalConversations} totalMessages={totalMessages} inboundMessages={chartData.reduce((sum, item) => sum + item.inbound, 0)} outboundMessages={chartData.reduce((sum, item) => sum + item.outbound, 0)} deliveryRate={deliveryRate} responseStats={responseStats} queueStats={queueStats} operations={operations} numbers={numbers} members={members} chartData={chartData} /></div></AdminSidebarLayout>;
}
