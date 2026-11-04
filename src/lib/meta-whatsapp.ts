import "server-only";

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { createAdminAlert } from "@/lib/admin-alerts";
import { metaTokenForNumber, metaTokenForWaba } from "@/lib/meta-credentials";
import { scanWithClamAV } from "@/lib/malware-scanner";
import { encryptMedia, mediaSha256 } from "@/lib/media-storage";
import { classifyMetaFailure, metaFailureGuidance } from "@/lib/meta-failure-classifier";
import { ensureWorkspace, getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

const configuredGraphVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
const graphVersion = /^v\d+\.\d+$/.test(configuredGraphVersion) ? configuredGraphVersion : "v26.0";
type Row = QueryResultRow;
type SendResult = { id: string; platformMessageId?: string; status: string; duplicate: boolean; failedOver?: boolean; senderNumberId?: string; transitionNoticeAttempted?: boolean; transitionNoticeSent?: boolean };
type MetaSendResponse = { messages?: { id?: string }[]; error?: { message?: string; code?: number; error_subcode?: number } };

export function verifyMetaSignature(rawBody: string, signature: string | null) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret || !signature?.startsWith("sha256=")) return false;
  const received = Buffer.from(signature.slice(7), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function statusFromDb(value: unknown) {
  switch (value) {
    case "SENT": return "sent";
    case "DELIVERED": return "delivered";
    case "READ": return "read";
    case "FAILED": return "failed";
    case "UNKNOWN": return "unknown";
    default: return "queued";
  }
}

async function saveSendResult(client: PoolClient, messageId: string, status: string, platformMessageId?: string | null, failureCode?: string | null, failureClass?: string | null) {
  const saved = await client.query<Row>(`UPDATE "Message" SET "status" = CASE WHEN "status" IN ('SENT','DELIVERED','READ','FAILED') THEN "status" ELSE $2::"MessageStatus" END, "platformMessageId" = COALESCE($3, "platformMessageId"),
      "failureCode" = CASE WHEN "status" IN ('SENT','DELIVERED','READ','FAILED') THEN "failureCode" ELSE $4 END,
      "failureClass" = CASE WHEN "status" IN ('SENT','DELIVERED','READ','FAILED') THEN "failureClass" WHEN $2 = 'FAILED' THEN COALESCE($5,'UNKNOWN_HOLD') WHEN $2 = 'UNKNOWN' THEN 'OUTCOME_UNKNOWN' ELSE NULL END,
      "sentAt" = CASE WHEN $2 = 'SENT' AND "status" NOT IN ('DELIVERED','READ','FAILED') THEN CURRENT_TIMESTAMP ELSE "sentAt" END
      WHERE "id" = $1 RETURNING "status","failureClass"`, [messageId, status, platformMessageId ?? null, failureCode ?? null, failureClass ?? null]);
  if (status === "FAILED" && saved.rows[0]?.status === "FAILED" && saved.rows[0]?.failureClass === (failureClass || "UNKNOWN_HOLD")) {
    const context = await client.query<Row>(`SELECT "workspaceId", "contactId", "channelNumberId", "failureCode" FROM "Message" WHERE "id"=$1`, [messageId]);
    const row = context.rows[0];
    const kind = (failureClass || "UNKNOWN_HOLD") as Parameters<typeof metaFailureGuidance>[0];
    if (row) {
      const guidance = metaFailureGuidance(kind);
      await createAdminAlert(client, { workspaceId: String(row.workspaceId), dedupeKey: `message-failure:${messageId}`, severity: guidance.severity, category: "MESSAGE_DELIVERY", title: guidance.title, message: `${guidance.message} Provider code: ${failureCode || "not supplied"}.`, targetType: "CONTACT", targetId: String(row.contactId) });
    }
  }
}


async function prepareConfirmedNumberFailover(messageId: string, sourceNumberId: string, error: MetaSendResponse["error"], httpStatus: number, templateMessage: boolean) {
  // Meta code 133010 is the explicit "phone number not registered" sender error.
  // No HTTP class, network timeout, quality warning, recipient, template, or account error is eligible.
  const errorCode = String(error?.code);
  if (errorCode !== "133010" || httpStatus === 401 || httpStatus === 403 || httpStatus === 429 || httpStatus >= 500) return null;
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const messageResult = await client.query<Row>(`SELECT m."workspaceId", m."contactId", m."conversationId", w."autoFailoverEnabled", w."failoverMaxAttempts", w."failoverCooldownMinutes", w."failoverRequiresApproval", source."metaWabaId", source."routingPriority"
      FROM "Message" m JOIN "Workspace" w ON w."id" = m."workspaceId" JOIN "ChannelNumber" source ON source."id" = m."channelNumberId"
      WHERE m."id" = $1 AND source."id" = $2 FOR UPDATE OF m, source, w`, [messageId, sourceNumberId]);
    const original = messageResult.rows[0];
    if (!original) { await client.query("ROLLBACK"); return null; }

    await client.query(`UPDATE "ChannelNumber" SET "state" = 'DISCONNECTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [sourceNumberId]);
    await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "targetType", "targetId", "details", "createdAt")
      VALUES ($1,$2,'CHANNEL_NUMBER_DISCONNECTED_AFTER_META_ERROR','CHANNEL_NUMBER',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), String(original.workspaceId), sourceNumberId, JSON.stringify({ errorCode, automaticFailoverEnabled: Boolean(original.autoFailoverEnabled) })]);
    await createAdminAlert(client, { workspaceId: String(original.workspaceId), dedupeKey: `sender-disconnected:${sourceNumberId}:${messageId}`, severity: "CRITICAL", category: "WHATSAPP_NUMBER", title: "WhatsApp sender disconnected", message: "Meta reported that this sender number is not registered. Review the number status and confirm any backup number before resuming traffic.", targetType: "CHANNEL_NUMBER", targetId: sourceNumberId });
    if (!original.autoFailoverEnabled) { await client.query("COMMIT"); return null; }
    const maxAttempts = Math.max(0, Math.min(1, Number(original.failoverMaxAttempts ?? 1)));
    if (maxAttempts === 0) {
      await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "targetType", "targetId", "details", "createdAt")
        VALUES ($1,$2,'CHANNEL_FAILOVER_SUPPRESSED','MESSAGE',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), String(original.workspaceId), messageId, JSON.stringify({ reason: "RETRY_LIMIT_ZERO", errorCode })]);
      await client.query("COMMIT"); return null;
    }
    if (!original.metaWabaId) {
      await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "targetType", "targetId", "details", "createdAt")
        VALUES ($1,$2,'CHANNEL_FAILOVER_SUPPRESSED','MESSAGE',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), String(original.workspaceId), messageId, JSON.stringify({ reason: "SOURCE_WABA_NOT_CONFIGURED", errorCode })]);
      await client.query("COMMIT"); return null;
    }

    const candidates = await client.query<Row>(`SELECT n."id", n."metaPhoneNumberId", n."routingPriority", c."id" AS "conversationId", c."serviceWindowExpiresAt",
          CASE WHEN c."id" IS NOT NULL THEN c."assignedTeamId" ELSE latest."assignedTeamId" END AS "assignedTeamId",
          route."id" AS "routingRuleId",route."version" AS "routingRuleVersion",
          COALESCE(array_position(route."channelOrder",to_jsonb(n."id")),2147483647) AS "rulePriority"
      FROM "ChannelNumber" n JOIN "Contact" contact ON contact."id"=$2 AND contact."workspaceId"=n."workspaceId" LEFT JOIN "Conversation" c ON c."contactId" = $2 AND c."channelNumberId" = n."id" AND c."workspaceId" = n."workspaceId"
      LEFT JOIN LATERAL (SELECT tc."assignedTeamId" FROM "Conversation" tc WHERE tc."workspaceId"=n."workspaceId" AND tc."contactId"=contact."id" ORDER BY tc."lastMessageAt" DESC,tc."updatedAt" DESC LIMIT 1) latest ON TRUE
      LEFT JOIN LATERAL (SELECT r."id",r."version",r."channelOrder" FROM "RoutingRule" r WHERE r."workspaceId"=n."workspaceId" AND r."enabled"=true AND (COALESCE(r."conditions"->>'phonePrefix','')='' OR regexp_replace(contact."primaryPhone",'\\D','','g') LIKE (r."conditions"->>'phonePrefix') || '%') AND (COALESCE(r."conditions"->>'teamId','')='' OR r."conditions"->>'teamId'=COALESCE(CASE WHEN c."id" IS NOT NULL THEN c."assignedTeamId" ELSE latest."assignedTeamId" END,'')) AND (COALESCE(r."conditions"->>'segmentId','')='' OR EXISTS (SELECT 1 FROM "CustomerSegment" seg WHERE seg."workspaceId"=r."workspaceId" AND seg."id"=r."conditions"->>'segmentId' AND (COALESCE(seg."filters"->>'tag','')='' OR contact."tags" @> ARRAY[seg."filters"->>'tag']) AND (COALESCE(seg."filters"->>'source','')='' OR lower(COALESCE(contact."source",''))=lower(seg."filters"->>'source')) AND (COALESCE(seg."filters"->>'ownerUserId','')='' OR contact."ownerUserId"=seg."filters"->>'ownerUserId') AND (COALESCE(seg."filters"->>'consent','any')='any' OR COALESCE((SELECT cr."status"::text FROM "ConsentRecord" cr WHERE cr."workspaceId"=contact."workspaceId" AND cr."contactId"=contact."id" AND cr."channel"='WHATSAPP' AND cr."scope"='WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC,cr."id" DESC LIMIT 1),'UNKNOWN')=CASE seg."filters"->>'consent' WHEN 'opted_in' THEN 'OPTED_IN' WHEN 'opted_out' THEN 'OPTED_OUT' ELSE 'UNKNOWN' END))) ORDER BY (r."conditions" ? 'segmentId') DESC,length(COALESCE(r."conditions"->>'phonePrefix','')) DESC,(r."conditions" ? 'teamId') DESC,r."priority",r."createdAt" LIMIT 1) route ON TRUE
      WHERE n."workspaceId" = $1 AND n."metaWabaId" = $3 AND n."id" <> $4 AND n."state" = 'ACTIVE' AND n."approvedByUserId" IS NOT NULL AND n."metaPhoneNumberId" IS NOT NULL
        AND ((n."whatsappConnectionId" IS NOT NULL AND EXISTS (SELECT 1 FROM "WhatsAppConnection" wc WHERE wc."id"=n."whatsappConnectionId" AND wc."workspaceId"=n."workspaceId" AND wc."status"='ACTIVE' AND (wc."tokenExpiresAt" IS NULL OR wc."tokenExpiresAt">CURRENT_TIMESTAMP))) OR (n."whatsappConnectionId" IS NULL AND $7::boolean))
        AND (cardinality(n."allowedTeamIds")=0 OR COALESCE(CASE WHEN c."id" IS NOT NULL THEN c."assignedTeamId" ELSE latest."assignedTeamId" END,'')=ANY(n."allowedTeamIds")) AND (route."channelOrder" IS NULL OR route."channelOrder" @> to_jsonb(n."id"))
        AND ($6=0 OR NOT EXISTS (SELECT 1 FROM "FailoverEvent" prior JOIN "Conversation" pc ON pc."id"=prior."conversationId" AND pc."workspaceId"=prior."workspaceId" WHERE prior."workspaceId"=n."workspaceId" AND prior."toChannelNumberId"=n."id" AND pc."contactId"=contact."id" AND prior."outcome" IN ('FAILED','NEEDS_REVIEW','SUPPRESSED','SCHEDULED') AND prior."createdAt">CURRENT_TIMESTAMP-($6 * INTERVAL '1 minute')))
      ORDER BY "rulePriority", CASE WHEN n."routingPriority" > $5 THEN 0 ELSE 1 END, n."routingPriority", n."createdAt"`, [String(original.workspaceId), String(original.contactId), String(original.metaWabaId), sourceNumberId, Number(original.routingPriority), Number(original.failoverCooldownMinutes ?? 60), Boolean(process.env.META_ACCESS_TOKEN)]);
    const alternate = candidates.rows.find((candidate) => templateMessage || (candidate.serviceWindowExpiresAt && new Date(String(candidate.serviceWindowExpiresAt)).getTime() > Date.now()));
    if (!alternate) {
      await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "targetType", "targetId", "details", "createdAt")
        VALUES ($1,$2,'CHANNEL_FAILOVER_SUPPRESSED','MESSAGE',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), String(original.workspaceId), messageId, JSON.stringify({ reason: templateMessage ? "NO_ACTIVE_SAME_WABA_BACKUP" : "NO_ACTIVE_SAME_WABA_BACKUP_WITH_OPEN_SERVICE_WINDOW", errorCode })]);
      await client.query("COMMIT"); return null;
    }

    let conversationId = alternate.conversationId == null ? "" : String(alternate.conversationId);
    if (!conversationId) {
      conversationId = randomUUID();
      await client.query(`INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelNumberId", "state", "assignedTeamId", "unreadCount", "lastMessageAt", "updatedAt")
        VALUES ($1,$2,$3,$4,'OPEN',$5,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("contactId", "channelNumberId") DO NOTHING`, [conversationId, String(original.workspaceId), String(original.contactId), String(alternate.id), alternate.assignedTeamId ?? null]);
      const found = await client.query<Row>(`SELECT "id" FROM "Conversation" WHERE "workspaceId" = $1 AND "contactId" = $2 AND "channelNumberId" = $3`, [String(original.workspaceId), String(original.contactId), String(alternate.id)]);
      conversationId = String(found.rows[0].id);
    }
    const failoverId = randomUUID();
    const approvalRequired = Boolean(original.failoverRequiresApproval);
    await client.query(`INSERT INTO "FailoverEvent" ("id", "workspaceId", "conversationId", "triggeringMessageId", "fromChannelNumberId", "toChannelNumberId", "scope", "reasonClass", "providerErrorCode", "providerErrorSubcode", "httpStatus", "routingRuleId", "routingRuleVersion", "approvalRequired", "outcome", "createdAt")
      VALUES ($1,$2,$3,$4,$5,$6,'PHONE_NUMBER','SENDER_NUMBER_NOT_REGISTERED',$7,$8,$9,$10,$11,$12,$13,CURRENT_TIMESTAMP)`, [failoverId, String(original.workspaceId), conversationId, messageId, sourceNumberId, String(alternate.id), error?.code ?? null, error?.error_subcode ?? null, httpStatus, alternate.routingRuleId ?? null, alternate.routingRuleVersion ?? null, approvalRequired, approvalRequired ? "NEEDS_REVIEW" : "SCHEDULED"]);
    await createAdminAlert(client, { workspaceId: String(original.workspaceId), dedupeKey: `failover:${failoverId}`, severity: approvalRequired ? "WARNING" : "WARNING", category: "FAILOVER", title: approvalRequired ? "Backup send needs administrator approval" : "Message moved to a backup number", message: approvalRequired ? "Meta confirmed the original sender is unregistered. Review and approve this specific backup send before the CRM sends it." : "The CRM is retrying an eligible message once on another active number. Review the conversation for its final delivery status.", targetType: "FAILOVER_EVENT", targetId: failoverId });
    await client.query("COMMIT");
    return { failoverId, senderNumberId: String(alternate.id), approvalRequired };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

async function ensureContactConversation(contactId: string, senderNumberId: string, transactionClient?: PoolClient) {
  const client = transactionClient ?? await getPostgresPool().connect();
  const ownsTransaction = !transactionClient;
  try {
    if (ownsTransaction) await client.query("BEGIN");
    const contact = await client.query<Row>(`SELECT "id","workspaceId","primaryPhone" FROM "Contact" WHERE "id"=$1 FOR UPDATE`, [contactId]);
    if (!contact.rows[0]) throw new Error("Customer not found in this workspace.");
    const workspaceId = String(contact.rows[0].workspaceId);
    const phoneDigits = String(contact.rows[0].primaryPhone).replace(/\D/g, "");
    let conversation = await client.query<Row>(`SELECT "id","assignedTeamId" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "channelNumberId"=$3 FOR UPDATE`, [workspaceId, contactId, senderNumberId]);
    const assigned = conversation.rows[0] ? null : await client.query<Row>(`SELECT "assignedTeamId" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 ORDER BY "lastMessageAt" DESC,"updatedAt" DESC LIMIT 1`, [workspaceId, contactId]);
    const teamId = conversation.rows[0]?.assignedTeamId != null ? String(conversation.rows[0].assignedTeamId) : assigned?.rows[0]?.assignedTeamId == null ? null : String(assigned.rows[0].assignedTeamId);
    const rules = await client.query<Row>(`SELECT r."channelOrder" FROM "RoutingRule" r WHERE r."workspaceId"=$1 AND r."enabled"=true AND (COALESCE(r."conditions"->>'phonePrefix','')='' OR $2 LIKE (r."conditions"->>'phonePrefix') || '%') AND (COALESCE(r."conditions"->>'teamId','')='' OR r."conditions"->>'teamId'=COALESCE($3,'')) AND (COALESCE(r."conditions"->>'segmentId','')='' OR EXISTS (SELECT 1 FROM "CustomerSegment" seg JOIN "Contact" c ON c."id"=$4 AND c."workspaceId"=seg."workspaceId" WHERE seg."workspaceId"=r."workspaceId" AND seg."id"=r."conditions"->>'segmentId' AND (COALESCE(seg."filters"->>'tag','')='' OR c."tags" @> ARRAY[seg."filters"->>'tag']) AND (COALESCE(seg."filters"->>'source','')='' OR lower(COALESCE(c."source",''))=lower(seg."filters"->>'source')) AND (COALESCE(seg."filters"->>'ownerUserId','')='' OR c."ownerUserId"=seg."filters"->>'ownerUserId') AND (COALESCE(seg."filters"->>'consent','any')='any' OR COALESCE((SELECT cr."status"::text FROM "ConsentRecord" cr WHERE cr."workspaceId"=c."workspaceId" AND cr."contactId"=c."id" AND cr."channel"='WHATSAPP' AND cr."scope"='WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC,cr."id" DESC LIMIT 1),'UNKNOWN')=CASE seg."filters"->>'consent' WHEN 'opted_in' THEN 'OPTED_IN' WHEN 'opted_out' THEN 'OPTED_OUT' ELSE 'UNKNOWN' END))) ORDER BY (r."conditions" ? 'segmentId') DESC,length(COALESCE(r."conditions"->>'phonePrefix','')) DESC,(r."conditions" ? 'teamId') DESC,r."priority",r."createdAt" LIMIT 1`, [workspaceId, phoneDigits, teamId, contactId]);
    const hasMatchingRule = rules.rows.length > 0;
    const ruleOrdered = Array.isArray(rules.rows[0]?.channelOrder) ? rules.rows[0].channelOrder.map(String) : [];
    const number = await client.query<Row>(`SELECT "id","state","metaWabaId","approvedByUserId","metaPhoneNumberId","allowedTeamIds" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "id"=$2 AND "state"='ACTIVE' AND "approvedByUserId" IS NOT NULL AND "metaPhoneNumberId" IS NOT NULL FOR UPDATE`, [workspaceId, senderNumberId]);
    if (!number.rows[0]) throw new Error("Choose an active, approved WhatsApp number.");
    const allowedTeamIds = Array.isArray(number.rows[0].allowedTeamIds) ? number.rows[0].allowedTeamIds.map(String) : [];
    if (allowedTeamIds.length && (!teamId || !allowedTeamIds.includes(teamId))) throw new Error("This WhatsApp number is not allowed for the conversation’s assigned team.");
    if (hasMatchingRule && (!ruleOrdered.length || !ruleOrdered.includes(senderNumberId))) throw new Error("This sender number is not allowed by the highest-priority matching customer routing rule.");
    if (!conversation.rows[0]) {
      const id = randomUUID();
      await client.query(`INSERT INTO "Conversation" ("id","workspaceId","contactId","channelNumberId","state","unreadCount","lastMessageAt","assignedTeamId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'OPEN',0,CURRENT_TIMESTAMP,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("contactId","channelNumberId") DO NOTHING`, [id, workspaceId, contactId, senderNumberId, teamId]);
      conversation = await client.query<Row>(`SELECT "id" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "channelNumberId"=$3`, [workspaceId, contactId, senderNumberId]);
    }
    if (ownsTransaction) await client.query("COMMIT");
    return { conversationId: String(conversation.rows[0].id), phone: phoneDigits };
  } catch (error) {
    if (ownsTransaction) { try { await client.query("ROLLBACK"); } catch {} }
    throw error;
  } finally { if (ownsTransaction) client.release(); }
}

async function finishFailover(failoverId: string, outcome: "SENT" | "FAILED" | "NEEDS_REVIEW") {
  await getPostgresPool().query(`UPDATE "FailoverEvent" SET "outcome" = $2::"FailoverOutcome" WHERE "id" = $1`, [failoverId, outcome]);
}

export async function sendConfiguredFailoverNotice(contactId: string, senderNumberId: string, triggeringMessageId: string) {
  const pool = getPostgresPool();
  const auditNotice = async (action: string, reason?: string) => {
    try {
      const workspaceId = await getWorkspaceIdForContact(contactId);
      await pool.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "action", "targetType", "targetId", "details", "createdAt")
        VALUES ($1,$2,$3,'MESSAGE',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, action, triggeringMessageId, JSON.stringify({ senderNumberId, ...(reason ? { reason } : {}) })]);
    } catch {}
  };
  try {
    const target = await pool.query<Row>(`SELECT w."failoverNotificationTemplateId", n."e164Number", n."metaWabaId"
      FROM "ChannelNumber" n JOIN "Workspace" w ON w."id" = n."workspaceId" WHERE n."id" = $1`, [senderNumberId]);
    const row = target.rows[0];
    if (!row?.failoverNotificationTemplateId) {
      await auditNotice("FAILOVER_NOTICE_SUPPRESSED", "NO_TEMPLATE_CONFIGURED");
      return { attempted: false, sent: false };
    }
    const template = await pool.query<Row>(`SELECT "status", "category", "components", "syncedAt" FROM "WhatsAppTemplate" WHERE "id" = $1 AND "workspaceId" = $2 AND "wabaId" = $3`, [String(row.failoverNotificationTemplateId), getWorkspaceIdForContact(contactId), String(row.metaWabaId)]);
    const saved = template.rows[0];
    const components = Array.isArray(saved?.components) ? saved.components as { type?: string; text?: string }[] : [];
    const variables = templateVariableNames(components);
    const hasSingleSupportedBodyVariable = variables.length === 1;
    if (!saved || String(saved.status).toUpperCase() !== "APPROVED" || String(saved.category).toUpperCase() !== "UTILITY" || Date.now() - new Date(String(saved.syncedAt)).getTime() > 24 * 60 * 60 * 1000 || !hasSingleSupportedBodyVariable) {
      await auditNotice("FAILOVER_NOTICE_SUPPRESSED", "TEMPLATE_NOT_CURRENTLY_ELIGIBLE");
      return { attempted: false, sent: false };
    }
    await sendCloudTemplateMessage({ contactId, senderNumberId, templateId: String(row.failoverNotificationTemplateId), parameters: [String(row.e164Number)], parameterNames: variables[0] && !/^\d+$/.test(variables[0]) ? variables : undefined, idempotencyKey: `transition:${triggeringMessageId}`, failoverAttempt: true });
    await auditNotice("FAILOVER_NOTICE_SENT");
    return { attempted: true, sent: true };
  } catch (error) {
    await auditNotice("FAILOVER_NOTICE_FAILED", error instanceof Error ? error.message.slice(0, 200) : "Notice send failed.");
    return { attempted: true, sent: false };
  }
}

async function getWorkspaceIdForContact(contactId: string) {
  const result = await getPostgresPool().query<Row>(`SELECT "workspaceId" FROM "Contact" WHERE "id" = $1`, [contactId]);
  if (!result.rows[0]) throw new Error("Contact not found.");
  return String(result.rows[0].workspaceId);
}

export async function sendCloudTextMessage(input: { contactId: string; senderNumberId: string; text: string; idempotencyKey: string; failoverAttempt?: boolean }): Promise<SendResult> {
  if (!process.env.DATABASE_URL) throw new Error("Live WhatsApp sending requires PostgreSQL storage.");
  const accessToken = await metaTokenForNumber(input.senderNumberId);
  if (!accessToken) throw new Error("WhatsApp Cloud API is not configured. Connect a Meta business account or set META_ACCESS_TOKEN on the server.");
  const pool = getPostgresPool();
  const client = await pool.connect();
  let messageId = "";
  let phoneNumberId = "";
  let recipient = "";
  let priorStatus: string | null = null;

  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    const prior = await client.query<Row>(`SELECT "id", "status" FROM "Message" WHERE "workspaceId" = $1 AND "idempotencyKey" = $2`, [workspaceId, input.idempotencyKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      priorStatus = String(row.status);
      messageId = String(row.id);
      await client.query("COMMIT");
      if (priorStatus === "SENT" || priorStatus === "DELIVERED" || priorStatus === "READ") return { id: messageId, status: statusFromDb(priorStatus), duplicate: true };
      throw new Error(priorStatus === "FAILED" ? "WhatsApp rejected this message. Review the error and send it again as a new message." : "This message already has a pending or uncertain send result. Check its status before retrying to avoid sending a duplicate.");
    }

    const target = await client.query<Row>(`SELECT c."id" AS "contactId", c."primaryPhone", c."suppressionState", n."id" AS "numberId", n."state" AS "numberState", n."metaPhoneNumberId", n."approvedByUserId", consent."status" AS "consentStatus", v."id" AS "conversationId", v."serviceWindowExpiresAt"
      FROM "Contact" c
      JOIN "ChannelNumber" n ON n."workspaceId" = c."workspaceId"
      LEFT JOIN "Conversation" v ON v."contactId" = c."id" AND v."workspaceId" = c."workspaceId" AND v."channelNumberId"=n."id"
      LEFT JOIN LATERAL (SELECT cr."status" FROM "ConsentRecord" cr WHERE cr."workspaceId" = c."workspaceId" AND cr."contactId" = c."id" AND cr."channel" = 'WHATSAPP' AND cr."scope" = 'WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC, cr."id" DESC LIMIT 1) consent ON true
      WHERE c."workspaceId" = $1 AND c."id" = $2 AND n."id" = $3
      FOR UPDATE OF c, v`, [workspaceId, input.contactId, input.senderNumberId]);
    const row = target.rows[0];
    if (!row) throw new Error("Customer or sender number not found in this workspace.");
    if (row.numberState !== "ACTIVE" || !row.approvedByUserId) throw new Error("Choose an active, approved WhatsApp number.");
    if (!row.metaPhoneNumberId) throw new Error("This sender number is missing its Meta phone number ID.");
    if (row.consentStatus !== "OPTED_IN") throw new Error("WhatsApp messaging is blocked until valid customer opt-in is recorded.");
    if (!row.conversationId) throw new Error("Start a new WhatsApp conversation with an approved template before sending free-form text.");
    if (!row.serviceWindowExpiresAt || new Date(String(row.serviceWindowExpiresAt)).getTime() <= Date.now()) throw new Error("The WhatsApp customer service window has expired. This text-only sender requires a valid approved template outside that window.");

    // Check sender-team permissions and the highest-priority routing rule on
    // the same transaction that reserves this outbound message.
    const route = await ensureContactConversation(input.contactId, input.senderNumberId, client);

    messageId = randomUUID();
    phoneNumberId = String(row.metaPhoneNumberId);
    recipient = String(row.primaryPhone).replace(/\D/g, "");
    await client.query(`INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "messageType", "textBody", "idempotencyKey", "createdAt")
      VALUES ($1,$2,$3,$4,$5,'OUTBOUND','QUEUED','text',$6,$7,CURRENT_TIMESTAMP)`, [messageId, workspaceId, route.conversationId, input.contactId, input.senderNumberId, input.text, input.idempotencyKey]);
    await client.query(`UPDATE "Conversation" SET "lastMessageAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [route.conversationId]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof Error) throw error;
    throw new Error("Could not prepare WhatsApp message.");
  } finally {
    client.release();
  }

  let response: Response;
  let payload: MetaSendResponse;
  try {
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: input.text } }),
      signal: AbortSignal.timeout(15_000),
    });
    payload = await response.json() as MetaSendResponse;
  } catch {
    const uncertain = await pool.connect();
    try { await saveSendResult(uncertain, messageId, "UNKNOWN"); } finally { uncertain.release(); }
    throw new Error("WhatsApp send outcome is unknown due to a network timeout. Check webhook delivery status before retrying; the CRM did not switch numbers.");
  }

  const platformMessageId = payload.messages?.[0]?.id;
  const resultClient = await pool.connect();
  const code = response.ok && platformMessageId ? null : payload.error?.code == null ? `HTTP_${response.status}` : String(payload.error.code);
  try {
    if (response.ok && platformMessageId) {
      await saveSendResult(resultClient, messageId, "SENT", platformMessageId);
    } else await saveSendResult(resultClient, messageId, "FAILED", null, code, classifyMetaFailure({ code: payload.error?.code, httpStatus: response.status }));
  } finally {
    resultClient.release();
  }
  if (!response.ok && (response.status === 401 || payload.error?.code === 190)) {
    const alertClient = await pool.connect();
    try { await createAdminAlert(alertClient, { workspaceId: getWorkspaceId(), dedupeKey: `meta-auth:${payload.error?.code ?? response.status}`, severity: "CRITICAL", category: "INTEGRATION", title: "WhatsApp authorization failed", message: "Meta rejected the configured access token. Outbound sending may be unavailable until an administrator restores valid permissions.", targetType: "INTEGRATION", targetId: "whatsapp-cloud-api" }); }
    finally { alertClient.release(); }
  }
  if (response.ok && platformMessageId) return { id: messageId, platformMessageId, status: "sent", duplicate: false };
  if (code) {
    if (!input.failoverAttempt) {
      const failover = await prepareConfirmedNumberFailover(messageId, input.senderNumberId, payload.error, response.status, false);
      if (failover) {
        if (failover.approvalRequired) throw new Error("This message is waiting for administrator approval before it can be sent from the backup number.");
        try {
          const retried = await sendCloudTextMessage({ ...input, senderNumberId: failover.senderNumberId, idempotencyKey: `${input.idempotencyKey}:failover`, failoverAttempt: true });
          try { await finishFailover(failover.failoverId, "SENT"); } catch {}
          const transitionNotice = await sendConfiguredFailoverNotice(input.contactId, failover.senderNumberId, messageId);
          return { ...retried, failedOver: true, senderNumberId: failover.senderNumberId, transitionNoticeAttempted: transitionNotice.attempted, transitionNoticeSent: transitionNotice.sent };
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          await finishFailover(failover.failoverId, message.includes("unknown") || message.includes("uncertain") ? "NEEDS_REVIEW" : "FAILED");
          throw error;
        }
      }
    }
    throw new Error(payload.error?.message || `WhatsApp rejected the message (HTTP ${response.status}). No alternate number was selected.`);
  }
  throw new Error(`WhatsApp rejected the message (HTTP ${response.status}). No alternate number was selected.`);
}

export async function sendCloudMediaMessage(input: { contactId: string; senderNumberId: string; file: Uint8Array; mimeType: string; filename: string; caption?: string; idempotencyKey: string }): Promise<SendResult> {
  if (!process.env.DATABASE_URL) throw new Error("Live WhatsApp media sending requires PostgreSQL storage.");
  const scan = await scanWithClamAV(input.file);
  if (!scan.clean) throw new Error("This attachment was blocked because malware was detected. Choose a clean file and try again.");
  const accessToken = await metaTokenForNumber(input.senderNumberId);
  if (!accessToken) throw new Error("WhatsApp Cloud API is not configured. Connect a Meta business account or set META_ACCESS_TOKEN on the server.");
  const kind = input.mimeType.startsWith("image/") ? "image" : input.mimeType.startsWith("video/") ? "video" : input.mimeType.startsWith("audio/") ? "audio" : "document";
  const pool = getPostgresPool();
  const client = await pool.connect();
  let messageId = "";
  let phoneNumberId = "";
  let recipient = "";
  const mediaMetadata = { type: kind, mimeType: input.mimeType, filename: input.filename, size: input.file.byteLength, caption: input.caption || null };
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    const prior = await client.query<Row>(`SELECT "id","status" FROM "Message" WHERE "workspaceId"=$1 AND "idempotencyKey"=$2`, [workspaceId, input.idempotencyKey]);
    if (prior.rows[0]) {
      const row = prior.rows[0]; messageId = String(row.id);
      await client.query("COMMIT");
      if (["SENT", "DELIVERED", "READ"].includes(String(row.status))) return { id: messageId, status: statusFromDb(row.status), duplicate: true };
      throw new Error(String(row.status) === "FAILED" ? "WhatsApp rejected this attachment. Review it and send again as a new message." : "This attachment already has a pending or uncertain send result. Check its status before retrying.");
    }
    const target = await client.query<Row>(`SELECT c."primaryPhone",c."suppressionState",n."metaPhoneNumberId",n."approvedByUserId",n."state" AS "numberState",v."id" AS "conversationId",consent."status" AS "consentStatus",v."serviceWindowExpiresAt"
      FROM "Contact" c JOIN "ChannelNumber" n ON n."workspaceId"=c."workspaceId"
      LEFT JOIN "Conversation" v ON v."contactId"=c."id" AND v."workspaceId"=c."workspaceId" AND v."channelNumberId"=n."id"
      LEFT JOIN LATERAL (SELECT cr."status" FROM "ConsentRecord" cr WHERE cr."workspaceId"=c."workspaceId" AND cr."contactId"=c."id" AND cr."channel"='WHATSAPP' AND cr."scope"='WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC,cr."id" DESC LIMIT 1) consent ON true
      WHERE c."workspaceId"=$1 AND c."id"=$2 AND n."id"=$3 FOR UPDATE OF c,n`, [workspaceId, input.contactId, input.senderNumberId]);
    const row = target.rows[0];
    if (!row) throw new Error("Customer or sender number not found in this workspace.");
    if (row.numberState !== "ACTIVE" || !row.approvedByUserId || !row.metaPhoneNumberId) throw new Error("Choose an active, approved WhatsApp number with a connected Meta phone ID.");
    if (row.consentStatus !== "OPTED_IN") throw new Error("WhatsApp messaging is blocked until valid customer opt-in is recorded.");
    if (!row.serviceWindowExpiresAt || new Date(String(row.serviceWindowExpiresAt)).getTime() <= Date.now()) throw new Error("The WhatsApp customer-service window is not open. Start with an approved template before sending an attachment.");
    const route = await ensureContactConversation(input.contactId, input.senderNumberId);
    messageId = randomUUID(); phoneNumberId = String(row.metaPhoneNumberId); recipient = String(row.primaryPhone).replace(/\D/g, "");
    await client.query(`INSERT INTO "Message" ("id","workspaceId","conversationId","contactId","channelNumberId","direction","status","messageType","textBody","media","idempotencyKey","createdAt") VALUES ($1,$2,$3,$4,$5,'OUTBOUND','SENDING',$6,$7,$8::jsonb,$9,CURRENT_TIMESTAMP)`, [messageId, workspaceId, route.conversationId, input.contactId, input.senderNumberId, kind, input.caption || null, JSON.stringify({ ...mediaMetadata, uploadState: "UPLOADING" }), input.idempotencyKey]);
    await client.query(`INSERT INTO "MessageAttachment" ("id","workspaceId","messageId","filename","mimeType","sizeBytes","sha256","encryptedContent","storageStatus","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'STORED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, messageId, input.filename, input.mimeType, input.file.byteLength, mediaSha256(input.file), encryptMedia(input.file)]);
    await client.query(`UPDATE "Conversation" SET "lastMessageAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [route.conversationId]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  let mediaId = "";
  try {
    const upload = new FormData();
    upload.set("messaging_product", "whatsapp"); upload.set("type", input.mimeType);
    upload.set("file", new Blob([new Uint8Array(input.file)], { type: input.mimeType }), input.filename);
    const uploadResponse = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/media`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` }, body: upload, signal: AbortSignal.timeout(30_000) });
    const uploadResult = await uploadResponse.json().catch(() => ({})) as { id?: string; error?: { message?: string; code?: number } };
    if (!uploadResponse.ok || !uploadResult.id) throw new Error(uploadResult.error?.message || `Meta rejected the media upload (HTTP ${uploadResponse.status}).`);
    mediaId = uploadResult.id;
  } catch (error) {
    const failure = await pool.connect();
    try { await saveSendResult(failure, messageId, "FAILED", null, "MEDIA_UPLOAD_FAILED", "UNKNOWN_HOLD"); } finally { failure.release(); }
    throw error;
  }
  await pool.query(`UPDATE "Message" SET "media"=$2::jsonb WHERE "id"=$1`, [messageId, JSON.stringify({ ...mediaMetadata, mediaId, uploadState: "UPLOADED" })]);
  await pool.query(`UPDATE "MessageAttachment" SET "providerMediaId"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "messageId"=$1`, [messageId, mediaId]);
  const mediaPayload: Record<string, unknown> = { id: mediaId };
  if (kind === "image" || kind === "video" || kind === "document") { if (input.caption) mediaPayload.caption = input.caption; }
  if (kind === "document") mediaPayload.filename = input.filename;
  let response: Response; let payload: MetaSendResponse;
  try {
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: kind, [kind]: mediaPayload }), signal: AbortSignal.timeout(15_000) });
    payload = await response.json().catch(() => ({})) as MetaSendResponse;
  } catch {
    const uncertain = await pool.connect();
    try { await saveSendResult(uncertain, messageId, "UNKNOWN"); } finally { uncertain.release(); }
    throw new Error("Attachment send outcome is unknown due to a network timeout. Check delivery status before retrying.");
  }
  const platformMessageId = payload.messages?.[0]?.id;
  const finalResult = await pool.connect();
  try {
    if (response.ok && platformMessageId) await saveSendResult(finalResult, messageId, "SENT", platformMessageId);
    else await saveSendResult(finalResult, messageId, "FAILED", null, payload.error?.code == null ? `HTTP_${response.status}` : String(payload.error.code), classifyMetaFailure({ code: payload.error?.code, httpStatus: response.status }));
  } finally { finalResult.release(); }
  if (!response.ok || !platformMessageId) throw new Error(payload.error?.message || `WhatsApp rejected the attachment (HTTP ${response.status}).`);
  await pool.query(`UPDATE "Message" SET "media"=$2::jsonb WHERE "id"=$1`, [messageId, JSON.stringify({ ...mediaMetadata, mediaId, uploadState: "SENT" })]);
  return { id: messageId, platformMessageId, status: "sent", duplicate: false };
}

type MetaTemplate = { id?: string; name?: string; language?: string; category?: string; status?: string; components?: unknown[] };
type MetaListResponse = { data?: MetaTemplate[]; paging?: { cursors?: { after?: string } }; error?: { message?: string } };

export async function syncWhatsAppTemplates(wabaId: string) {
  if (!process.env.DATABASE_URL) throw new Error("Template sync requires PostgreSQL storage.");
  const accessToken = await metaTokenForWaba(wabaId);
  if (!accessToken) throw new Error("WhatsApp Cloud API is not configured. Connect this Meta business account or set META_ACCESS_TOKEN on the server.");
  const pool = getPostgresPool();
  const workspaceClient = await pool.connect();
  let workspaceId: string;
  try {
    workspaceId = await ensureWorkspace(workspaceClient);
    const mapped = await workspaceClient.query<Row>(`SELECT 1 FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "metaWabaId" = $2 LIMIT 1`, [workspaceId, wabaId]);
    if (!mapped.rows.length) throw new Error("Choose a WABA ID already assigned to a CRM sender number.");
  } finally { workspaceClient.release(); }

  let after: string | undefined;
  let synced = 0;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates`);
    url.searchParams.set("fields", "id,name,status,category,language,components");
    url.searchParams.set("limit", "100");
    if (after) url.searchParams.set("after", after);
    const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15_000) });
    const result = await response.json().catch(() => ({})) as MetaListResponse;
    if (!response.ok) throw new Error(result.error?.message || `Meta template sync failed (HTTP ${response.status}).`);
    for (const template of result.data ?? []) {
      if (!template.name || !template.language) continue;
      const client = await pool.connect();
      try {
        await client.query(`INSERT INTO "WhatsAppTemplate" ("id", "workspaceId", "wabaId", "metaTemplateId", "name", "language", "category", "status", "statusUpdatedAt", "components", "syncedAt", "updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CURRENT_TIMESTAMP,$9::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT ("wabaId", "name", "language") DO UPDATE SET "metaTemplateId" = EXCLUDED."metaTemplateId", "category" = EXCLUDED."category", "statusReason" = CASE WHEN "WhatsAppTemplate"."status" <> EXCLUDED."status" THEN NULL ELSE "WhatsAppTemplate"."statusReason" END, "statusUpdatedAt" = CASE WHEN "WhatsAppTemplate"."status" <> EXCLUDED."status" THEN CURRENT_TIMESTAMP ELSE "WhatsAppTemplate"."statusUpdatedAt" END, "status" = EXCLUDED."status", "components" = EXCLUDED."components", "syncedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP`,
        [randomUUID(), workspaceId, wabaId, template.id ?? null, template.name, template.language, template.category ?? "UNKNOWN", String(template.status ?? "UNKNOWN").toUpperCase(), JSON.stringify(template.components ?? [])]);
        synced += 1;
      } finally { client.release(); }
    }
    after = result.paging?.cursors?.after;
    if (!after || !(result.data?.length)) break;
  }
  return { synced };
}

function templateVariableNames(components: unknown) {
  if (!Array.isArray(components)) return [];
  const body = components.find((component) => typeof component === "object" && component !== null && String((component as { type?: unknown }).type).toUpperCase() === "BODY") as { text?: unknown } | undefined;
  if (typeof body?.text !== "string") return [];
  const tokens = [...body.text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  const positional = tokens.length > 0 && tokens.every((token) => /^\d+$/.test(token));
  const named = tokens.length > 0 && tokens.every((token) => /^[a-z][a-z0-9_]*$/.test(token));
  if (!positional && !named) return [];
  const variables = positional
    ? [...new Set(tokens.map(Number))].sort((left, right) => left - right).map(String)
    : [...new Set(tokens)];
  if (positional && variables.some((value, index) => Number(value) !== index + 1)) return [];
  return variables;
}

function templateText(components: unknown, parameters: string[], parameterNames?: string[]) {
  if (!Array.isArray(components)) throw new Error("Template has no readable component definition. Sync it again from Meta.");
  const body = components.find((component) => typeof component === "object" && component !== null && String((component as { type?: unknown }).type).toUpperCase() === "BODY") as { text?: unknown } | undefined;
  if (typeof body?.text !== "string") throw new Error("This template does not have a text body supported by the current composer.");
  const unsupportedVariables = components.some((component) => {
    if (component === body || typeof component !== "object" || component === null) return false;
    const text = (component as { text?: unknown }).text;
    return typeof text === "string" && /\{\{[^}]+\}\}/.test(text);
  });
  if (unsupportedVariables) throw new Error("This template has header or button variables. Only text-body variables are supported by this composer.");
  const tokens = [...body.text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  const variables = templateVariableNames(components);
  const positional = tokens.length > 0 && tokens.every((token) => /^\d+$/.test(token));
  const named = tokens.length > 0 && tokens.every((token) => /^[a-z][a-z0-9_]*$/.test(token));
  if (tokens.length && !positional && !named) throw new Error("This template mixes or uses unsupported variable formats. Use either numbered variables or lowercase named variables in its BODY.");
  if (tokens.length && !variables.length) throw new Error("This template has an invalid or incomplete BODY variable definition. Sync it again before sending.");
  if (named && parameterNames && (parameterNames.length !== variables.length || new Set(parameterNames).size !== variables.length || variables.some((variable) => !parameterNames.includes(variable)))) throw new Error("The saved named template values no longer match the approved template. Prepare a new message from the synced template.");
  if (named && !parameterNames) throw new Error("Named BODY values are missing their parameter names. Prepare a new message from the synced template.");
  if (positional && parameterNames?.length) throw new Error("This numbered template cannot use named parameter values.");
  if (parameters.length !== variables.length) throw new Error(`Provide exactly ${variables.length} ${named ? "named" : "numbered"} BODY value${variables.length === 1 ? "" : "s"} for this template.`);
  const values = new Map(variables.map((variable, index) => [variable, parameters[parameterNames?.indexOf(variable) ?? index]]));
  const rendered = body.text.replace(/\{\{([^{}]+)\}\}/g, (_match, variable: string) => values.get(variable) ?? "");
  const providerParameters = variables.map((variable) => ({ type: "text", text: values.get(variable) ?? "", ...(named ? { parameter_name: variable } : {}) }));
  return { rendered, parameters: providerParameters, count: variables.length, variableNames: named ? variables : undefined };
}

export async function sendCloudTemplateMessage(input: { contactId: string; senderNumberId: string; templateId: string; parameters: string[]; parameterNames?: string[]; idempotencyKey: string; failoverAttempt?: boolean }): Promise<SendResult> {
  if (!process.env.DATABASE_URL) throw new Error("Live WhatsApp sending requires PostgreSQL storage.");
  const accessToken = await metaTokenForNumber(input.senderNumberId);
  if (!accessToken) throw new Error("WhatsApp Cloud API is not configured. Connect a Meta business account or set META_ACCESS_TOKEN on the server.");
  const pool = getPostgresPool();
  const client = await pool.connect();
  let messageId = "";
  let phoneNumberId = "";
  let recipient = "";
  let templateName = "";
  let language = "";
  let preview = "";
  let parameters: string[] = [];
  let providerParameters: { type: string; text: string; parameter_name?: string }[] = [];
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    const prior = await client.query<Row>(`SELECT "id", "status" FROM "Message" WHERE "workspaceId" = $1 AND "idempotencyKey" = $2`, [workspaceId, input.idempotencyKey]);
    if (prior.rows.length) {
      const row = prior.rows[0];
      const status = String(row.status);
      messageId = String(row.id);
      await client.query("COMMIT");
      if (["SENT", "DELIVERED", "READ"].includes(status)) return { id: messageId, status: statusFromDb(status), duplicate: true };
      throw new Error(status === "FAILED" ? "WhatsApp rejected this template. Review it and send again as a new message." : "This template send is pending or uncertain. Check its status before retrying to avoid a duplicate.");
    }
    const target = await client.query<Row>(`SELECT c."id" AS "contactId", c."primaryPhone", c."suppressionState", n."id" AS "numberId", n."state" AS "numberState", n."metaPhoneNumberId", n."metaWabaId", n."approvedByUserId", consent."status" AS "consentStatus", v."id" AS "conversationId"
      FROM "Contact" c JOIN "ChannelNumber" n ON n."workspaceId" = c."workspaceId"
      LEFT JOIN "Conversation" v ON v."workspaceId" = c."workspaceId" AND v."contactId" = c."id" AND v."channelNumberId" = n."id"
      LEFT JOIN LATERAL (SELECT cr."status" FROM "ConsentRecord" cr WHERE cr."workspaceId" = c."workspaceId" AND cr."contactId" = c."id" AND cr."channel" = 'WHATSAPP' AND cr."scope" = 'WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC, cr."id" DESC LIMIT 1) consent ON true
      WHERE c."workspaceId" = $1 AND c."id" = $2 AND n."id" = $3 FOR UPDATE OF c,n`, [workspaceId, input.contactId, input.senderNumberId]);
    const row = target.rows[0];
    if (!row) throw new Error("Customer or sender number not found in this workspace.");
    if (row.numberState !== "ACTIVE" || !row.approvedByUserId) throw new Error("Choose an active, approved WhatsApp number.");
    if (!row.metaPhoneNumberId || !row.metaWabaId) throw new Error("This sender number needs its Meta phone number ID and WABA ID configured.");
    if (row.consentStatus !== "OPTED_IN") throw new Error("WhatsApp messaging is blocked until valid customer opt-in is recorded.");
    const route = await ensureContactConversation(input.contactId, input.senderNumberId);
    const savedTemplate = await client.query<Row>(`SELECT "name", "language", "status", "components", "syncedAt" FROM "WhatsAppTemplate" WHERE "id" = $1 AND "workspaceId" = $2 AND "wabaId" = $3`, [input.templateId, workspaceId, row.metaWabaId]);
    const template = savedTemplate.rows[0];
    if (!template || String(template.status).toUpperCase() !== "APPROVED") throw new Error("Choose a template currently approved in Meta.");
    if (new Date(String(template.syncedAt)).getTime() < Date.now() - 24 * 60 * 60 * 1000) throw new Error("Refresh template status from Meta before sending; this approval snapshot is over 24 hours old.");
    parameters = input.parameters.map((value) => value.trim());
    if (parameters.some((value) => !value || value.length > 1024)) throw new Error("Template values must be non-empty and 1,024 characters or fewer.");
    const rendered = templateText(template.components, parameters, input.parameterNames);
    preview = rendered.rendered;
    providerParameters = rendered.parameters;
    templateName = String(template.name);
    language = String(template.language);
    phoneNumberId = String(row.metaPhoneNumberId);
    recipient = route.phone;
    const conversationId = route.conversationId;
    messageId = randomUUID();
    const media = JSON.stringify({ bodyParameters: parameters, ...(rendered.variableNames ? { bodyParameterNames: rendered.variableNames } : {}), language });
    await client.query(`INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "messageType", "textBody", "media", "templateName", "idempotencyKey", "createdAt")
      VALUES ($1,$2,$3,$4,$5,'OUTBOUND','QUEUED','template',$6,$7::jsonb,$8,$9,CURRENT_TIMESTAMP)`, [messageId, workspaceId, conversationId, input.contactId, input.senderNumberId, preview, media, templateName, input.idempotencyKey]);
    await client.query(`UPDATE "Conversation" SET "lastMessageAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [conversationId]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error instanceof Error ? error : new Error("Could not prepare WhatsApp template message.");
  } finally { client.release(); }

  let response: Response;
  let result: MetaSendResponse;
  try {
    const components = providerParameters.length ? [{ type: "body", parameters: providerParameters }] : [];
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`, {
      method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "template", template: { name: templateName, language: { code: language }, ...(components.length ? { components } : {}) } }),
      signal: AbortSignal.timeout(15_000),
    });
    result = await response.json() as MetaSendResponse;
  } catch {
    const uncertain = await pool.connect();
    try { await saveSendResult(uncertain, messageId, "UNKNOWN"); } finally { uncertain.release(); }
    throw new Error("WhatsApp template send outcome is unknown. Check the webhook delivery status before retrying; the CRM did not switch numbers.");
  }
  const providerId = result.messages?.[0]?.id;
  const resultClient = await pool.connect();
  const code = response.ok && providerId ? null : result.error?.code == null ? `HTTP_${response.status}` : String(result.error.code);
  try {
    if (response.ok && providerId) {
      await saveSendResult(resultClient, messageId, "SENT", providerId);
    } else await saveSendResult(resultClient, messageId, "FAILED", null, code, classifyMetaFailure({ code: result.error?.code, httpStatus: response.status }));
  } finally { resultClient.release(); }
  if (response.ok && providerId) return { id: messageId, platformMessageId: providerId, status: "sent", duplicate: false };
  if (code) {
    if (!input.failoverAttempt) {
      const failover = await prepareConfirmedNumberFailover(messageId, input.senderNumberId, result.error, response.status, true);
      if (failover) {
        if (failover.approvalRequired) throw new Error("This message is waiting for administrator approval before it can be sent from the backup number.");
        try {
          const retried = await sendCloudTemplateMessage({ ...input, senderNumberId: failover.senderNumberId, idempotencyKey: `${input.idempotencyKey}:failover`, failoverAttempt: true });
          try { await finishFailover(failover.failoverId, "SENT"); } catch {}
          const transitionNotice = await sendConfiguredFailoverNotice(input.contactId, failover.senderNumberId, messageId);
          return { ...retried, failedOver: true, senderNumberId: failover.senderNumberId, transitionNoticeAttempted: transitionNotice.attempted, transitionNoticeSent: transitionNotice.sent };
        } catch (error) {
          const message = error instanceof Error ? error.message.toLowerCase() : "";
          await finishFailover(failover.failoverId, message.includes("unknown") || message.includes("uncertain") ? "NEEDS_REVIEW" : "FAILED");
          throw error;
        }
      }
    }
    throw new Error(result.error?.message || `WhatsApp rejected the template (HTTP ${response.status}).`);
  }
  throw new Error(`WhatsApp rejected the template (HTTP ${response.status}).`);
}

/** Re-send only a provider-confirmed failed text/template as a distinct message. */
export async function retryConfirmedMessage(input: { messageId: string; senderNumberId: string; actorUserId: string; sourceIp?: string; userAgent?: string }) {
  if (!process.env.DATABASE_URL) throw new Error("Retrying a WhatsApp message requires PostgreSQL storage.");
  const pool = getPostgresPool();
  const client = await pool.connect();
  let source: Row;
  let idempotencyKey: string;
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    const selected = await client.query<Row>(`SELECT m."id",m."contactId",m."channelNumberId",m."status",m."messageType",m."textBody",m."media",m."failureClass",m."failureCode",m."templateName"
      FROM "Message" m JOIN "WorkspaceUser" wu ON wu."workspaceId"=m."workspaceId" AND wu."userId"=$3 JOIN "User" actor ON actor."id"=wu."userId" AND actor."active"=true
      WHERE m."workspaceId"=$1 AND m."id"=$2 AND m."direction"='OUTBOUND' FOR UPDATE OF m`, [workspaceId, input.messageId, input.actorUserId]);
    source = selected.rows[0];
    if (!source) throw new Error("Outbound message not found.");
    if (String(source.status) !== "FAILED" || !source.failureClass || ["UNKNOWN_HOLD", "OUTCOME_UNKNOWN"].includes(String(source.failureClass))) throw new Error("Only a provider-confirmed failed message can be retried. Unknown outcomes must be reconciled from delivery status first.");
    if (/^HTTP_5\d\d$/.test(String(source.failureCode ?? ""))) throw new Error("Meta returned a server error whose acceptance status is unclear. Reconcile delivery status before creating another send.");
    if (!String(source.textBody ?? "").trim()) throw new Error("This failed message has no saved text content to retry.");
    if (!["text", "template"].includes(String(source.messageType))) throw new Error("Only text and template messages can be retried from this action. Attachments must be selected and scanned again.");
    idempotencyKey = `manual-retry:${input.messageId}`;
    const prior = await client.query<Row>(`SELECT "id","status","retryMessageId","updatedAt" FROM "MessageRetry" WHERE "workspaceId"=$1 AND "idempotencyKey"=$2 FOR UPDATE`, [workspaceId, idempotencyKey]);
    if (prior.rows[0]) {
      let retryStatus = String(prior.rows[0].status);
      const ageMs = Date.now() - new Date(String(prior.rows[0].updatedAt)).getTime();
      if (retryStatus === "PROCESSING" && ageMs >= 5 * 60 * 1000) {
        retryStatus = "NEEDS_REVIEW";
        await client.query(`UPDATE "MessageRetry" SET "status"='NEEDS_REVIEW',"errorSummary"='Retry claim expired before its final state was recorded. Reconcile the WhatsApp status before sending again.',"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "idempotencyKey"=$2`, [workspaceId, idempotencyKey]);
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'MESSAGE_RETRY_NEEDS_REVIEW','MESSAGE',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, input.messageId, JSON.stringify({ reason: "STALE_RETRY_CLAIM", retryKey: idempotencyKey })]);
      }
      await client.query("COMMIT");
      return { id: String(prior.rows[0].retryMessageId ?? prior.rows[0].id), duplicate: true, status: retryStatus, needsReview: retryStatus === "NEEDS_REVIEW" };
    }
    await client.query(`INSERT INTO "MessageRetry" ("id","workspaceId","sourceMessageId","actorUserId","status","idempotencyKey","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'PROCESSING',$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.messageId, input.actorUserId, idempotencyKey]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","sourceIp","userAgent","createdAt")
      VALUES ($1,$2,$3,'MESSAGE_RETRY_REQUESTED','MESSAGE',$4,$5::jsonb,$6,$7,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, input.messageId, JSON.stringify({ sourceMessageId: input.messageId, sourceNumberId: source.channelNumberId, selectedSenderNumberId: input.senderNumberId, messageType: source.messageType, failureClass: source.failureClass, retryKey: idempotencyKey }), input.sourceIp ?? null, input.userAgent?.slice(0, 512) ?? null]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  const auditRetryFailure = async (error: unknown) => {
    const summary = error instanceof Error ? error.message.slice(0, 240) : "Retry failed.";
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const retryWorkspaceId = getWorkspaceId();
      const retryMessage = await client.query<Row>(`SELECT "id" FROM "Message" WHERE "workspaceId"=$1 AND "idempotencyKey"=$2 LIMIT 1`, [retryWorkspaceId, idempotencyKey]);
      if (!retryMessage.rows[0]) {
        // The send path has not persisted an outbound message, so its preflight
        // checks stopped dispatch. Release only our still-processing claim so
        // an administrator can retry after fixing the underlying condition.
        const released = await client.query<Row>(`DELETE FROM "MessageRetry" WHERE "workspaceId"=$1 AND "idempotencyKey"=$2 AND "status"='PROCESSING' RETURNING "id"`, [retryWorkspaceId, idempotencyKey]);
        if (released.rows[0]) {
          await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","sourceIp","userAgent","createdAt")
            VALUES ($1,$2,$3,'MESSAGE_RETRY_BLOCKED_BEFORE_DISPATCH','MESSAGE',$4,$5::jsonb,$6,$7,CURRENT_TIMESTAMP)`, [randomUUID(), retryWorkspaceId, input.actorUserId, input.messageId, JSON.stringify({ sourceMessageId: input.messageId, selectedSenderNumberId: input.senderNumberId, retryKey: idempotencyKey, summary }), input.sourceIp ?? null, input.userAgent?.slice(0, 512) ?? null]);
        }
      } else {
        await client.query(`UPDATE "MessageRetry" SET "status"=$3,"errorSummary"=$4,"retryMessageId"=COALESCE($5,"retryMessageId"),"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "idempotencyKey"=$2 AND "status"='PROCESSING'`, [retryWorkspaceId, idempotencyKey, /unknown|uncertain|acceptance status/i.test(summary) ? "NEEDS_REVIEW" : "FAILED", summary, retryMessage.rows[0].id]);
      }
      await client.query("COMMIT");
    } catch (failure) {
      try { await client.query("ROLLBACK"); } catch {}
      throw failure;
    } finally { client.release(); }
  };

  if (String(source.messageType) === "text") {
    try {
      const sent = await sendCloudTextMessage({ contactId: String(source.contactId), senderNumberId: input.senderNumberId, text: String(source.textBody), idempotencyKey });
      await pool.query(`UPDATE "MessageRetry" SET "status"=CASE WHEN "status"='FAILED' THEN "status" ELSE 'SENT' END,"retryMessageId"=COALESCE("retryMessageId",$3),"errorSummary"=CASE WHEN "status"='FAILED' THEN "errorSummary" ELSE NULL END,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "idempotencyKey"=$2`, [getWorkspaceId(), idempotencyKey, sent.id]);
      return { ...sent, duplicate: sent.duplicate };
    } catch (error) {
      await auditRetryFailure(error);
      throw error;
    }
  }
  const saved = source.media && typeof source.media === "object" ? source.media as Record<string, unknown> : {};
  try {
    const name = String(source.templateName ?? "");
    const language = String(saved.language ?? "");
    const parameters = Array.isArray(saved.bodyParameters) ? saved.bodyParameters.map(String) : [];
    const parameterNames = Array.isArray(saved.bodyParameterNames) ? saved.bodyParameterNames.map(String) : undefined;
    if (!name || !language) throw new Error("The saved template details are incomplete; sync templates and send a new template message.");
    const template = await pool.query<Row>(`SELECT "id" FROM "WhatsAppTemplate" WHERE "workspaceId"=$1 AND "wabaId"=(SELECT "metaWabaId" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "id"=$2) AND "name"=$3 AND "language"=$4 AND "status"='APPROVED' AND "syncedAt">CURRENT_TIMESTAMP-INTERVAL '24 hours' ORDER BY "syncedAt" DESC LIMIT 1`, [getWorkspaceId(), input.senderNumberId, name, language]);
    if (!template.rows[0]) throw new Error("The original template is no longer recently confirmed as approved. Sync templates and send a new approved template.");
    const sent = await sendCloudTemplateMessage({ contactId: String(source.contactId), senderNumberId: input.senderNumberId, templateId: String(template.rows[0].id), parameters, parameterNames, idempotencyKey });
    await pool.query(`UPDATE "MessageRetry" SET "status"=CASE WHEN "status"='FAILED' THEN "status" ELSE 'SENT' END,"retryMessageId"=COALESCE("retryMessageId",$3),"errorSummary"=CASE WHEN "status"='FAILED' THEN "errorSummary" ELSE NULL END,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "idempotencyKey"=$2`, [getWorkspaceId(), idempotencyKey, sent.id]);
    return sent;
  } catch (error) {
    await auditRetryFailure(error);
    throw error;
  }
}
