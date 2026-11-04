import { randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange, requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { recoverPendingWebhookEvents } from "@/lib/whatsapp-webhook-processor";
import { recoverStaleMessageRetries } from "@/lib/message-retry-recovery";
import { createAdminAlert } from "@/lib/admin-alerts";
import { sendCloudTemplateMessage, sendCloudTextMessage, sendConfiguredFailoverNotice } from "@/lib/meta-whatsapp";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;

async function alertIfBacklogged(workspaceId: string) {
  const pool = getPostgresPool();
  const result = await pool.query<Row>(`SELECT COUNT(*)::int AS "pending", COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN("receivedAt")))::int,0) AS "lagSeconds"
    FROM "WebhookEvent" WHERE "workspaceId"=$1 AND "processingState" IN ('RECEIVED','PROCESSING')`, [workspaceId]);
  const pending = Number(result.rows[0]?.pending ?? 0); const lagSeconds = Number(result.rows[0]?.lagSeconds ?? 0);
  if (pending < 10 || lagSeconds < 300) return;
  const client = await pool.connect();
  try { await createAdminAlert(client, { workspaceId, dedupeKey: `webhook-backlog:${Math.floor(Date.now() / 3_600_000)}`, severity: "CRITICAL", category: "WEBHOOK", title: "WhatsApp webhook backlog is growing", message: `${pending} events are waiting or processing; the oldest has been waiting for approximately ${Math.floor(lagSeconds / 60)} minutes. Review webhook health and recovery status.`, targetType: "WEBHOOK_BACKLOG" }); }
  finally { client.release(); }
}

function hasRecoverySecret(request: NextRequest) {
  const expected = process.env.WEBHOOK_RECOVERY_SECRET;
  const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Webhook recovery requires PostgreSQL." }, { status: 503 });
  try {
    const pool = getPostgresPool();
    const [counts, latestFailed, channelMetrics, messageMetrics, lagMetrics, recentFailovers, pendingFailovers, mediaCounts] = await Promise.all([
      pool.query<Row>(`SELECT "processingState", COUNT(*)::int AS "count" FROM "WebhookEvent" WHERE "workspaceId" = $1 GROUP BY "processingState"`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT "id", "eventType", "errorSummary", "attemptCount", "receivedAt", "nextAttemptAt" FROM "WebhookEvent" WHERE "workspaceId" = $1 AND "processingState" = 'FAILED' ORDER BY "receivedAt" DESC LIMIT 1`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT COUNT(*) FILTER (WHERE "state"='ACTIVE')::int AS "activeNumbers" FROM "ChannelNumber" WHERE "workspaceId"=$1`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT MAX("receivedAt") FILTER (WHERE "direction"='INBOUND') AS "lastInboundAt", MAX("createdAt") FILTER (WHERE "direction"='OUTBOUND') AS "lastOutboundAt",
          COUNT(*) FILTER (WHERE "status" IN ('QUEUED','SENDING','UNKNOWN'))::int AS "queueDepth",
          COUNT(*) FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours' AND "status"='FAILED')::int AS "failed24h",
          COUNT(*) FILTER (WHERE "createdAt">=CURRENT_TIMESTAMP-INTERVAL '24 hours')::int AS "total24h"
        FROM "Message" WHERE "workspaceId"=$1`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT COALESCE(EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN("receivedAt")))::int,0) AS "webhookLagSeconds" FROM "WebhookEvent" WHERE "workspaceId"=$1 AND "processingState" IN ('RECEIVED','PROCESSING')`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT f."id",f."scope",f."reasonClass",f."providerErrorCode",f."providerErrorSubcode",f."httpStatus",f."routingRuleId",f."routingRuleVersion",f."outcome",f."createdAt",src."label" AS "fromLabel",dst."label" AS "toLabel"
        FROM "FailoverEvent" f JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId"
        WHERE f."workspaceId"=$1 ORDER BY f."createdAt" DESC LIMIT 5`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT f."id",f."triggeringMessageId",f."reasonClass",f."providerErrorCode",f."routingRuleId",f."routingRuleVersion",f."approvalRequired",f."outcome",f."approvalProcessingAt",f."createdAt",m."messageType",left(COALESCE(m."textBody",''),220) AS "messagePreview",src."label" AS "fromLabel",dst."label" AS "toLabel"
        FROM "FailoverEvent" f JOIN "Message" m ON m."id"=f."triggeringMessageId" AND m."workspaceId"=f."workspaceId"
        JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId"
        WHERE f."workspaceId"=$1 AND ((f."approvalRequired"=true AND f."outcome"='NEEDS_REVIEW') OR (f."outcome"='SCHEDULED' AND f."approvalReviewedByUserId" IS NOT NULL)) ORDER BY f."createdAt" LIMIT 20`, [getWorkspaceId()]),
      pool.query<Row>(`SELECT "storageStatus",COUNT(*)::int AS "count" FROM "MessageAttachment" WHERE "workspaceId"=$1 GROUP BY "storageStatus"`, [getWorkspaceId()]),
    ]);
    const message = messageMetrics.rows[0] ?? {};
    const total24h = Number(message.total24h ?? 0); const failed24h = Number(message.failed24h ?? 0);
    const serializeDate = (value: unknown) => value == null ? null : new Date(String(value)).toISOString();
    return NextResponse.json({
      counts: Object.fromEntries(counts.rows.map((row) => [String(row.processingState), Number(row.count)])),
      latestFailed: latestFailed.rows[0] ?? null,
      pendingFailovers: pendingFailovers.rows.map((row) => ({ id: String(row.id), triggeringMessageId: String(row.triggeringMessageId ?? ""), fromLabel: String(row.fromLabel), toLabel: String(row.toLabel), reasonClass: String(row.reasonClass), messageType: String(row.messageType), messagePreview: String(row.messagePreview), providerErrorCode: row.providerErrorCode == null ? null : Number(row.providerErrorCode), routingRuleId: row.routingRuleId == null ? null : String(row.routingRuleId), routingRuleVersion: row.routingRuleVersion == null ? null : Number(row.routingRuleVersion), approvalRequired: Boolean(row.approvalRequired), outcome: String(row.outcome), canResume: row.approvalProcessingAt != null && new Date(String(row.approvalProcessingAt)).getTime() < Date.now() - 5 * 60_000, createdAt: serializeDate(row.createdAt) })),
      mediaCounts: Object.fromEntries(mediaCounts.rows.map((row) => [String(row.storageStatus), Number(row.count)])),
      health: { activeNumbers: Number(channelMetrics.rows[0]?.activeNumbers ?? 0), lastInboundAt: serializeDate(message.lastInboundAt), lastOutboundAt: serializeDate(message.lastOutboundAt), queueDepth: Number(message.queueDepth ?? 0), failed24h, total24h, failureRate24h: total24h ? Math.round(failed24h * 1000 / total24h) / 10 : 0, webhookLagSeconds: Number(lagMetrics.rows[0]?.webhookLagSeconds ?? 0), recentFailovers: recentFailovers.rows.map((row) => ({ id: String(row.id), fromLabel: String(row.fromLabel), toLabel: String(row.toLabel), reasonClass: String(row.reasonClass), providerErrorCode: row.providerErrorCode == null ? null : Number(row.providerErrorCode), providerErrorSubcode: row.providerErrorSubcode == null ? null : Number(row.providerErrorSubcode), httpStatus: row.httpStatus == null ? null : Number(row.httpStatus), routingRuleId: row.routingRuleId == null ? null : String(row.routingRuleId), routingRuleVersion: row.routingRuleVersion == null ? null : Number(row.routingRuleVersion), outcome: String(row.outcome), createdAt: serializeDate(row.createdAt) })) },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read webhook health." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireOwner();
  if (!session && !hasRecoverySecret(request)) return NextResponse.json({ error: "Administrator sign-in or a valid recovery secret is required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Webhook recovery requires PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { limit?: number; retryEventId?: string; failoverAction?: "APPROVE" | "DECLINE" | "RESUME"; failoverId?: string } | null;
  if (body?.failoverAction) {
    if (!["APPROVE", "DECLINE", "RESUME"].includes(body.failoverAction)) return NextResponse.json({ error: "Choose approve, decline, or resume for this backup send." }, { status: 400 });
    const { session: admin, needsMfa } = await requireMfaForAdminChange();
    if (!admin) return NextResponse.json({ error: "Administrator sign-in is required to review a backup send." }, { status: 401 });
    if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("reviewing backup sends") }, { status: 403 });
    if (!body.failoverId || body.failoverId.length > 128) return NextResponse.json({ error: "Choose a valid backup-send request." }, { status: 400 });
    const pool = getPostgresPool();
    const client = await pool.connect();
    let requestRow: Row | undefined;
    try {
      await client.query("BEGIN");
      const event = await client.query<Row>(`SELECT f."id",f."triggeringMessageId",f."fromChannelNumberId",f."toChannelNumberId",f."reasonClass",f."outcome",f."approvalRequired",f."approvalProcessingAt",f."approvalReviewedByUserId",
          m."workspaceId",m."contactId",m."status" AS "messageStatus",m."failureCode",m."textBody",m."messageType",m."templateName",m."media",
          dst."metaWabaId",dst."metaPhoneNumberId",dst."whatsappConnectionId",dst."state" AS "targetState",dst."approvedByUserId",wc."status" AS "targetConnectionStatus",wc."tokenExpiresAt" AS "targetTokenExpiresAt",src."metaWabaId" AS "sourceWabaId",w."autoFailoverEnabled",w."failoverMaxAttempts"
        FROM "FailoverEvent" f JOIN "Message" m ON m."id"=f."triggeringMessageId" AND m."workspaceId"=f."workspaceId"
        JOIN "ChannelNumber" dst ON dst."id"=f."toChannelNumberId" AND dst."workspaceId"=f."workspaceId"
        LEFT JOIN "WhatsAppConnection" wc ON wc."id"=dst."whatsappConnectionId" AND wc."workspaceId"=dst."workspaceId"
        JOIN "ChannelNumber" src ON src."id"=f."fromChannelNumberId" AND src."workspaceId"=f."workspaceId"
        JOIN "Workspace" w ON w."id"=f."workspaceId"
        WHERE f."workspaceId"=$1 AND f."id"=$2 FOR UPDATE OF f,m`, [getWorkspaceId(), body.failoverId]);
      requestRow = event.rows[0];
      if (!requestRow) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Backup-send request was not found." }, { status: 404 }); }
      if (body.failoverAction === "DECLINE") {
        if (!requestRow.approvalRequired || String(requestRow.outcome) !== "NEEDS_REVIEW") { await client.query("ROLLBACK"); return NextResponse.json({ error: "This request is no longer awaiting approval." }, { status: 409 }); }
        await client.query(`UPDATE "FailoverEvent" SET "approvalRequired"=false,"approvalReviewedByUserId"=$3,"outcome"='SUPPRESSED' WHERE "id"=$1 AND "workspaceId"=$2`, [body.failoverId, getWorkspaceId(), admin.userId]);
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'FAILOVER_SEND_DECLINED','FAILOVER_EVENT',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), admin.userId, body.failoverId, JSON.stringify({ reasonClass: String(requestRow.reasonClass ?? "SENDER_NUMBER_NOT_REGISTERED") })]);
        await client.query("COMMIT");
        return NextResponse.json({ outcome: "SUPPRESSED" }, { headers: { "Cache-Control": "no-store" } });
      }
      const isPendingApproval = Boolean(requestRow.approvalRequired) && String(requestRow.outcome) === "NEEDS_REVIEW";
      const isResumingApproved = body.failoverAction === "RESUME" && !requestRow.approvalRequired && String(requestRow.outcome) === "SCHEDULED" && requestRow.approvalReviewedByUserId != null && requestRow.approvalProcessingAt != null && new Date(String(requestRow.approvalProcessingAt)).getTime() < Date.now() - 5 * 60_000;
      if ((body.failoverAction === "APPROVE" && !isPendingApproval) || (body.failoverAction === "RESUME" && !isResumingApproved)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This backup send is not pending approval or recovery." }, { status: 409 }); }
      if (String(requestRow.messageStatus) !== "FAILED" || String(requestRow.failureCode) !== "133010") { await client.query("ROLLBACK"); return NextResponse.json({ error: "The original message is no longer a confirmed sender-registration failure." }, { status: 409 }); }
      if (String(requestRow.targetState) !== "ACTIVE" || !requestRow.approvedByUserId || !requestRow.metaWabaId || !requestRow.metaPhoneNumberId) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The selected backup number is no longer approved, active, and mapped to a Meta phone number." }, { status: 409 }); }
      const hasCurrentMetaAuthorization = requestRow.whatsappConnectionId != null
        ? String(requestRow.targetConnectionStatus) === "ACTIVE" && (requestRow.targetTokenExpiresAt == null || new Date(String(requestRow.targetTokenExpiresAt)).getTime() > Date.now())
        : Boolean(process.env.META_ACCESS_TOKEN);
      if (!hasCurrentMetaAuthorization) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The selected backup number no longer has a usable Meta authorization. Reconnect its business account before approving this send." }, { status: 409 }); }
      if (!requestRow.autoFailoverEnabled || Number(requestRow.failoverMaxAttempts) < 1) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Failover was disabled or its retry cap was set to zero after this request was created." }, { status: 409 }); }
      if (String(requestRow.sourceWabaId ?? "") !== String(requestRow.metaWabaId)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The source and backup numbers are no longer connected to the same WABA." }, { status: 409 }); }
      if (isPendingApproval) {
        await client.query(`UPDATE "FailoverEvent" SET "approvalRequired"=false,"approvalReviewedByUserId"=$3,"approvalProcessingAt"=CURRENT_TIMESTAMP,"outcome"='SCHEDULED' WHERE "id"=$1 AND "workspaceId"=$2`, [body.failoverId, getWorkspaceId(), admin.userId]);
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'FAILOVER_SEND_APPROVED','FAILOVER_EVENT',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), admin.userId, body.failoverId, JSON.stringify({ toChannelNumberId: String(requestRow.toChannelNumberId) })]);
      }
      else await client.query(`UPDATE "FailoverEvent" SET "approvalProcessingAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "workspaceId"=$2`, [body.failoverId, getWorkspaceId()]);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not review this backup send." }, { status: 503 });
    } finally { client.release(); }

    try {
      const media = requestRow.media && typeof requestRow.media === "object" ? requestRow.media as Record<string, unknown> : {};
      const idempotencyKey = `approved-failover:${body.failoverId}`;
      let sendResult;
      if (String(requestRow.messageType) === "template") {
        const language = typeof media.language === "string" ? media.language : "";
        const template = await pool.query<Row>(`SELECT "id" FROM "WhatsAppTemplate" WHERE "workspaceId"=$1 AND "wabaId"=$2 AND "name"=$3 AND "language"=$4 AND "status"='APPROVED' AND "syncedAt">CURRENT_TIMESTAMP-INTERVAL '24 hours' ORDER BY "syncedAt" DESC LIMIT 1`, [getWorkspaceId(), String(requestRow.metaWabaId), String(requestRow.templateName ?? ""), language]);
        const parameters = Array.isArray(media.bodyParameters) ? media.bodyParameters.map(String) : [];
        const parameterNames = Array.isArray(media.bodyParameterNames) ? media.bodyParameterNames.map(String) : undefined;
        if (!template.rows[0] || !language) return NextResponse.json({ error: "The original approved template is no longer current on this WABA; refresh templates and review the message before retrying." }, { status: 409 });
        sendResult = await sendCloudTemplateMessage({ contactId: String(requestRow.contactId), senderNumberId: String(requestRow.toChannelNumberId), templateId: String(template.rows[0].id), parameters, parameterNames, idempotencyKey, failoverAttempt: true });
      } else if (String(requestRow.messageType) === "text" && typeof requestRow.textBody === "string") {
        sendResult = await sendCloudTextMessage({ contactId: String(requestRow.contactId), senderNumberId: String(requestRow.toChannelNumberId), text: requestRow.textBody, idempotencyKey, failoverAttempt: true });
      } else return NextResponse.json({ error: "Only saved text and template messages can be approved for backup sending." }, { status: 409 });
      await pool.query(`UPDATE "FailoverEvent" SET "outcome"='SENT',"approvalProcessingAt"=NULL WHERE "workspaceId"=$1 AND "id"=$2`, [getWorkspaceId(), body.failoverId]);
      const notice = await sendConfiguredFailoverNotice(String(requestRow.contactId), String(requestRow.toChannelNumberId), String(requestRow.triggeringMessageId));
      return NextResponse.json({ outcome: "SENT", duplicate: sendResult.duplicate, transitionNoticeAttempted: notice.attempted, transitionNoticeSent: notice.sent }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Backup send failed.";
      const uncertain = /unknown|uncertain|pending/i.test(message);
      await pool.query(`UPDATE "FailoverEvent" SET "outcome"=$3::"FailoverOutcome","approvalProcessingAt"=NULL WHERE "workspaceId"=$1 AND "id"=$2 AND "outcome"='SCHEDULED'`, [getWorkspaceId(), body.failoverId, uncertain ? "NEEDS_REVIEW" : "FAILED"]);
      return NextResponse.json({ error: message, outcome: uncertain ? "NEEDS_REVIEW" : "FAILED" }, { status: 502 });
    }
  }
  if (body?.retryEventId) {
    if (!session) return NextResponse.json({ error: "Administrator sign-in is required to manually retry an event." }, { status: 401 });
    try {
      await recoverStaleMessageRetries(getWorkspaceId());
      const result = await getPostgresPool().query<Row>(`UPDATE "WebhookEvent" SET "processingState" = 'RECEIVED', "attemptCount" = 0, "processingStartedAt" = NULL, "nextAttemptAt" = CURRENT_TIMESTAMP, "errorSummary" = NULL
        WHERE "workspaceId" = $1 AND "id" = $2 AND "processingState" = 'FAILED' RETURNING "id"`, [getWorkspaceId(), body.retryEventId]);
      if (!result.rows.length) return NextResponse.json({ error: "That event is no longer failed or does not belong to this workspace." }, { status: 404 });
      const recovered = await recoverPendingWebhookEvents(getWorkspaceId(), 1, body.retryEventId);
      await alertIfBacklogged(getWorkspaceId());
      return NextResponse.json(recovered, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not retry the selected event." }, { status: 503 });
    }
  }
  const limit = Number.isInteger(body?.limit) ? Math.max(1, Math.min(100, Number(body?.limit))) : 50;
  try {
    const retryClaimsMovedToReview = await recoverStaleMessageRetries(getWorkspaceId());
    const result = await recoverPendingWebhookEvents(getWorkspaceId(), limit);
    await alertIfBacklogged(getWorkspaceId());
    return NextResponse.json({ ...result, retryClaimsMovedToReview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook recovery failed." }, { status: 503 });
  }
}
