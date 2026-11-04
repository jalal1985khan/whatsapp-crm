import Link from "next/link";
import { ArrowLeft, BarChart3, CheckCheck, Clock3, MessageSquareText, RotateCcw, Users, Webhook } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getCrmSnapshot } from "@/lib/crm-store";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "Owner" && session.role !== "Admin") redirect("/");
  const isPostgres = Boolean(process.env.DATABASE_URL);
  const { chats, numbers } = await getCrmSnapshot();
  let responseStats: { answered: number; medianMinutes: number | null; p95Minutes: number | null } | null = null;
  let queueStats: { awaiting: number; under15m: number; under1h: number; under4h: number; over4h: number; oldestMinutes: number | null } | null = null;
  let operations: { pendingWebhooks: number; oldestWebhookMinutes: number | null; outbound24Hours: number; confirmed24Hours: number; failed24Hours: number; unresolved24Hours: number; pendingSend24Hours: number; failureRate: number | null; recentFailovers: { from: string; to: string; outcome: string; reason: string; createdAt: string }[] } | null = null;
  let reportError = "";
  if (isPostgres) {
    try {
      const pool = getPostgresPool();
      const workspaceId = getWorkspaceId();
      const [responses, queue] = await Promise.all([
        pool.query<QueryResultRow>(`WITH first_inbound AS (
          SELECT m."conversationId",MIN(m."createdAt") AS "firstInboundAt"
          FROM "Message" m WHERE m."workspaceId"=$1 AND m."direction"='INBOUND' AND m."createdAt">=CURRENT_TIMESTAMP-INTERVAL '30 days'
          GROUP BY m."conversationId"
        ), first_reply AS (
          SELECT i."conversationId",EXTRACT(EPOCH FROM (MIN(o."createdAt")-i."firstInboundAt"))/60.0 AS "minutes"
          FROM first_inbound i JOIN "Message" o ON o."workspaceId"=$1 AND o."conversationId"=i."conversationId" AND o."direction"='OUTBOUND' AND o."status" IN ('SENT','DELIVERED','READ') AND o."createdAt">=i."firstInboundAt"
          GROUP BY i."conversationId",i."firstInboundAt"
        ) SELECT COUNT(*)::int AS "answered",PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "minutes") AS "medianMinutes",PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY "minutes") AS "p95Minutes" FROM first_reply`, [workspaceId]),
        pool.query<QueryResultRow>(`WITH active AS (
          SELECT "id" FROM "Conversation" WHERE "workspaceId"=$1 AND "state" IN ('OPEN','WAITING')
        ), recent AS (
          SELECT m."conversationId",MAX(m."createdAt") FILTER (WHERE m."direction"='INBOUND') AS "lastInboundAt",MAX(m."createdAt") FILTER (WHERE m."direction"='OUTBOUND' AND m."status" IN ('SENT','DELIVERED','READ')) AS "lastOutboundAt"
          FROM "Message" m JOIN active c ON c."id"=m."conversationId" WHERE m."workspaceId"=$1 AND m."direction" IN ('INBOUND','OUTBOUND') GROUP BY m."conversationId"
        ), waiting AS (
          SELECT EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-r."lastInboundAt"))/60.0 AS "minutes" FROM recent r
          WHERE r."lastInboundAt" IS NOT NULL AND (r."lastOutboundAt" IS NULL OR r."lastInboundAt">r."lastOutboundAt")
        ) SELECT COUNT(*)::int AS "awaiting",COUNT(*) FILTER (WHERE "minutes"<15)::int AS "under15m",COUNT(*) FILTER (WHERE "minutes">=15 AND "minutes"<60)::int AS "under1h",COUNT(*) FILTER (WHERE "minutes">=60 AND "minutes"<240)::int AS "under4h",COUNT(*) FILTER (WHERE "minutes">=240)::int AS "over4h",MAX("minutes") AS "oldestMinutes" FROM waiting`, [workspaceId]),
      ]);
      const response = responses.rows[0] ?? {}; const waiting = queue.rows[0] ?? {};
      responseStats = { answered: Number(response.answered ?? 0), medianMinutes: response.medianMinutes == null ? null : Number(response.medianMinutes), p95Minutes: response.p95Minutes == null ? null : Number(response.p95Minutes) };
      queueStats = { awaiting: Number(waiting.awaiting ?? 0), under15m: Number(waiting.under15m ?? 0), under1h: Number(waiting.under1h ?? 0), under4h: Number(waiting.under4h ?? 0), over4h: Number(waiting.over4h ?? 0), oldestMinutes: waiting.oldestMinutes == null ? null : Number(waiting.oldestMinutes) };
      const [webhooks, deliveries, failovers] = await Promise.all([
        pool.query<QueryResultRow>(`SELECT COUNT(*) FILTER (WHERE "processingState" IN ('RECEIVED','PROCESSING','FAILED'))::int AS "pending",EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN("receivedAt") FILTER (WHERE "processingState" IN ('RECEIVED','PROCESSING','FAILED'))))/60.0 AS "oldestMinutes" FROM "WebhookEvent" WHERE "workspaceId"=$1`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT COUNT(*)::int AS "outbound",
          COUNT(*) FILTER (WHERE "status" IN ('SENT','DELIVERED','READ') OR ("status"='FAILED' AND COALESCE("failureClass",'')<>'OUTCOME_UNKNOWN'))::int AS "confirmed",
          COUNT(*) FILTER (WHERE "status"='FAILED' AND COALESCE("failureClass",'')<>'OUTCOME_UNKNOWN')::int AS "failed",
          COUNT(*) FILTER (WHERE "status"='UNKNOWN' OR ("status"='FAILED' AND "failureClass"='OUTCOME_UNKNOWN'))::int AS "unresolved",
          COUNT(*) FILTER (WHERE "status" IN ('QUEUED','SENDING'))::int AS "pending"
          FROM "Message" WHERE "workspaceId"=$1 AND "direction"='OUTBOUND' AND "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours'`, [workspaceId]),
        pool.query<QueryResultRow>(`SELECT src."label" AS "fromLabel",dst."label" AS "toLabel",f."outcome",f."reasonClass",f."createdAt" FROM "FailoverEvent" f JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId" WHERE f."workspaceId"=$1 ORDER BY f."createdAt" DESC LIMIT 5`, [workspaceId]),
      ]);
      const webhook = webhooks.rows[0] ?? {}; const delivery = deliveries.rows[0] ?? {};
      const outbound24Hours = Number(delivery.outbound ?? 0); const confirmed24Hours = Number(delivery.confirmed ?? 0); const failed24Hours = Number(delivery.failed ?? 0);
      operations = { pendingWebhooks: Number(webhook.pending ?? 0), oldestWebhookMinutes: webhook.oldestMinutes == null ? null : Number(webhook.oldestMinutes), outbound24Hours, confirmed24Hours, failed24Hours, unresolved24Hours: Number(delivery.unresolved ?? 0), pendingSend24Hours: Number(delivery.pending ?? 0), failureRate: confirmed24Hours ? failed24Hours / confirmed24Hours * 100 : null, recentFailovers: failovers.rows.map((row) => ({ from: String(row.fromLabel), to: String(row.toLabel), outcome: String(row.outcome), reason: String(row.reasonClass).replaceAll("_", " ").toLowerCase(), createdAt: new Date(String(row.createdAt)).toISOString() })) };
    } catch { reportError = "Operational reporting is temporarily unavailable. Check the PostgreSQL connection and migrations."; }
  }
  const formatMinutes = (minutes: number | null) => minutes == null ? "—" : minutes < 60 ? `${Math.round(minutes)} min` : `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
  const messages = chats.flatMap((chat) => chat.messages);
  const outgoing = messages.filter((message) => message.mine).length;
  const unread = chats.filter((chat) => Boolean(chat.unread)).length;
  const resolved = chats.filter((chat) => chat.state === "Resolved").length;
  const metrics = [
    { label: "Customers", value: chats.length, helper: "Customer records", icon: Users },
    { label: "Messages stored", value: messages.length, helper: "Across all conversations", icon: MessageSquareText },
    { label: "Unread conversations", value: unread, helper: "Need a team response", icon: Clock3 },
    { label: "Resolved", value: resolved, helper: "Closed conversations", icon: CheckCheck },
  ];
  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><BarChart3 className="size-4" /></div><span className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Reports</span></span></div><Link href="/"><Button variant="outline" size="sm"><ArrowLeft data-icon="inline-start" />Back to inbox</Button></Link></header>
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8"><div className="mb-6 flex items-end justify-between"><div><h1 className="text-2xl font-semibold tracking-tight">Workspace overview</h1><p className="mt-1 text-sm text-muted-foreground">A snapshot of the CRM activity stored in this workspace.</p></div><Badge variant={isPostgres ? "success" : "warning"}>{isPostgres ? "PostgreSQL data" : "Local demo data"}</Badge></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, helper, icon: Icon }) => <section key={label} className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><Icon className="size-4 text-primary" /></div><div className="mt-4 text-3xl font-semibold tracking-tight">{value}</div><p className="mt-1 text-xs text-muted-foreground">{helper}</p></section>)}</div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[1.3fr_1fr]"><section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold">Messaging activity</h2><p className="mt-1 text-xs text-muted-foreground">Messages present in {isPostgres ? "the PostgreSQL workspace" : "the local CRM store"}.</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[#f7f9f7] p-4"><div className="text-xs text-muted-foreground">Inbound</div><div className="mt-2 text-2xl font-semibold">{messages.length - outgoing}</div></div><div className="rounded-xl bg-[#f7f9f7] p-4"><div className="text-xs text-muted-foreground">Outbound</div><div className="mt-2 text-2xl font-semibold">{outgoing}</div></div></div><p className="mt-4 text-[11px] text-muted-foreground">Delivery, response-time, and trend reporting use persisted message events and update when the page is refreshed.</p></section>
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center justify-between"><div><h2 className="text-sm font-semibold">Sender numbers</h2><p className="mt-1 text-xs text-muted-foreground">Number availability in this CRM.</p></div><Link href="/admin/numbers" className="text-xs font-medium text-primary">Manage</Link></div><div className="mt-4 flex flex-col gap-3">{numbers.map((number) => <div key={number.id} className="flex items-center gap-3 rounded-xl border p-3"><span className={`size-2 rounded-full ${number.state === "Active" ? "bg-emerald-500" : number.state === "Paused" ? "bg-slate-400" : "bg-amber-400"}`} /><div className="min-w-0 flex-1"><div className="truncate text-xs font-medium">{number.label}</div><div className="text-[10px] text-muted-foreground">{number.number}</div></div><Badge variant={number.state === "Active" ? "success" : "outline"}>{number.state}</Badge></div>)}</div></section></div>
      {isPostgres && responseStats && queueStats && <div className="mt-4 grid gap-4 lg:grid-cols-2"><section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Clock3 className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">First response · 30 days</h2><p className="text-xs text-muted-foreground">From a customer’s first inbound message to the first agent reply.</p></div></div><div className="mt-5 grid grid-cols-3 gap-3"><div className="rounded-xl bg-[#f7f9f7] p-3"><p className="text-[10px] text-muted-foreground">Answered</p><p className="mt-1 text-xl font-semibold">{responseStats.answered}</p></div><div className="rounded-xl bg-[#f7f9f7] p-3"><p className="text-[10px] text-muted-foreground">Median</p><p className="mt-1 text-xl font-semibold">{formatMinutes(responseStats.medianMinutes)}</p></div><div className="rounded-xl bg-[#f7f9f7] p-3"><p className="text-[10px] text-muted-foreground">95th percentile</p><p className="mt-1 text-xl font-semibold">{formatMinutes(responseStats.p95Minutes)}</p></div></div></section><section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Clock3 className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">Unanswered queue age</h2><p className="text-xs text-muted-foreground">Open conversations where the latest customer message is waiting for a reply.</p></div></div><div className="mt-4 flex items-baseline justify-between"><p className="text-3xl font-semibold">{queueStats.awaiting}</p><p className="text-xs text-muted-foreground">Oldest: {formatMinutes(queueStats.oldestMinutes)}</p></div><div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">{[["Under 15 min", queueStats.under15m], ["15–59 min", queueStats.under1h], ["1–4 hours", queueStats.under4h], ["Over 4 hours", queueStats.over4h]].map(([label, value]) => <div key={String(label)} className="rounded-lg border p-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div></section></div>}
      {isPostgres && operations && <div className="mt-4 grid gap-4 lg:grid-cols-3"><section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Webhook className="size-4 text-primary" /><h2 className="text-sm font-semibold">Webhook queue</h2></div><p className="mt-4 text-3xl font-semibold">{operations.pendingWebhooks}</p><p className="mt-1 text-xs text-muted-foreground">Waiting, processing, or failed events</p><p className="mt-3 border-t pt-3 text-xs text-muted-foreground">Oldest event: {formatMinutes(operations.oldestWebhookMinutes)}</p><Link href="/admin/webhooks" className="mt-3 inline-block text-xs font-medium text-primary hover:underline">Review webhook health</Link></section><section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h2 className="text-sm font-semibold">Confirmed failures · 24 hours</h2></div><p className="mt-4 text-3xl font-semibold">{operations.failureRate == null ? "—" : `${operations.failureRate.toFixed(1)}%`}</p><p className="mt-1 text-xs text-muted-foreground">{operations.failed24Hours} confirmed failures of {operations.confirmed24Hours} confirmed outcomes</p><div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground"><span>Unresolved: {operations.unresolved24Hours}</span><span>Still queued: {operations.pendingSend24Hours}</span></div><p className="mt-2 text-[10px] text-muted-foreground">Unknown and pending sends are excluded from the confirmed failure rate.</p></section><section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><RotateCcw className="size-4 text-primary" /><h2 className="text-sm font-semibold">Recent number changes</h2></div><div className="mt-3 space-y-2">{operations.recentFailovers.length ? operations.recentFailovers.map((event, index) => <div key={`${event.createdAt}-${index}`} className="border-b pb-2 last:border-0"><p className="text-xs font-medium">{event.from} → {event.to} <span className="font-normal text-muted-foreground">· {event.outcome.replaceAll("_", " ").toLowerCase()}</span></p><p className="mt-0.5 text-[10px] text-muted-foreground">{event.reason} · {new Date(event.createdAt).toLocaleString()}</p></div>) : <p className="py-4 text-xs text-muted-foreground">No failover events recorded.</p>}</div></section></div>}
      {isPostgres && reportError && <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950">{reportError}</div>}
      {!isPostgres && <div className="mt-4 rounded-xl border bg-white p-4 text-xs text-muted-foreground">First-response and queue-age metrics require PostgreSQL message timestamps.</div>}
    </div>
  </main>;
}
