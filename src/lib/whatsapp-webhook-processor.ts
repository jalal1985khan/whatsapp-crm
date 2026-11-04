import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { createAdminAlert } from "@/lib/admin-alerts";
import { getPostgresPool } from "@/lib/postgres-pool";
import { metaTokenForNumber } from "@/lib/meta-credentials";
import { decryptMedia, encryptMedia, mediaSha256 } from "@/lib/media-storage";
import { scanWithClamAV } from "@/lib/malware-scanner";
import { classifyMetaFailure, metaFailureGuidance } from "@/lib/meta-failure-classifier";

type Row = QueryResultRow;

type MetaMessage = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; [key: string]: unknown };
type MetaStatus = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[]; [key: string]: unknown };
export type WebhookEventWork = { eventId: string; workspaceId: string; channelNumberId: string | null; metaWabaId?: string; kind: "message" | "status" | "account_update" | "quality_update" | "template_status_update" | "template_quality_update"; profileName?: string; data: MetaMessage | MetaStatus | Record<string, unknown> };

function phone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^[1-9]\d{1,14}$/.test(digits)) throw new Error("Inbound webhook sender is not a valid international phone number.");
  return `+${digits}`;
}
function timestamp(value: unknown) {
  if (typeof value !== "string" || !/^\d{9,12}$/.test(value)) throw new Error("WhatsApp webhook timestamp is missing or invalid.");
  const date = new Date(Number(value) * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("WhatsApp webhook timestamp is outside the supported date range.");
  return date;
}
function textFor(message: MetaMessage) {
  if (message.type === "text" && typeof message.text?.body === "string") return message.text.body;
  const media = message.type ? message[message.type] as { caption?: unknown } | undefined : undefined;
  if (typeof media?.caption === "string") return media.caption;
  const labels: Record<string, string> = { image: "Image", audio: "Audio message", video: "Video", document: "Document", sticker: "Sticker", location: "Location", contacts: "Contact card", interactive: "Interactive message", button: "Button response", order: "Order" };
  return `[${labels[String(message.type)] ?? "Unsupported WhatsApp message"}]`;
}

async function applyMessage(client: PoolClient, item: WebhookEventWork) {
  const message = item.data as MetaMessage;
  if (!message.id || !message.from) throw new Error("Inbound webhook message has no message ID or sender.");
  const sender = phone(message.from);
  const profileName = item.profileName;
  const knownContact = await client.query<Row>(`SELECT COALESCE(c."mergedIntoContactId",c."id") AS "id" FROM "Contact" c WHERE c."workspaceId"=$1 AND (c."primaryPhone"=$2 OR EXISTS (SELECT 1 FROM "ContactIdentifier" ci WHERE ci."workspaceId"=$1 AND ci."contactId"=c."id" AND ci."type"='PHONE' AND ci."normalizedValue"=$2)) ORDER BY CASE WHEN c."primaryPhone"=$2 THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`, [item.workspaceId, sender]);
  const contactResult = knownContact.rows[0]
    ? await client.query<Row>(`UPDATE "Contact" SET "displayName"=COALESCE("displayName",$3),"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [item.workspaceId, String(knownContact.rows[0].id), profileName ?? null])
    : await client.query<Row>(`INSERT INTO "Contact" ("id", "workspaceId", "displayName", "primaryPhone", "updatedAt")
        VALUES ($1,$2,$3,$4,CURRENT_TIMESTAMP)
        ON CONFLICT ("workspaceId", "primaryPhone") DO UPDATE SET "displayName" = COALESCE("Contact"."displayName", EXCLUDED."displayName"), "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id"`, [randomUUID(), item.workspaceId, profileName ?? null, sender]);
  const contactId = String(contactResult.rows[0].id);
  await client.query(`INSERT INTO "ContactIdentifier" ("id", "workspaceId", "contactId", "type", "normalizedValue", "verified", "source")
    VALUES ($1,$2,$3,'PHONE',$4,false,'WHATSAPP_WEBHOOK') ON CONFLICT ("contactId", "type", "normalizedValue") DO NOTHING`, [randomUUID(), item.workspaceId, contactId, sender]);

  const sentAt = timestamp(message.timestamp);
  const expiresAt = new Date(sentAt.getTime() + 24 * 60 * 60 * 1000);
  const conversationResult = await client.query<Row>(`INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelNumberId", "state", "unreadCount", "lastMessageAt", "serviceWindowExpiresAt", "updatedAt")
    VALUES ($1,$2,$3,$4,'OPEN',1,$5,$6,CURRENT_TIMESTAMP)
    ON CONFLICT ("contactId", "channelNumberId") DO UPDATE SET "unreadCount" = "Conversation"."unreadCount" + 1,
      "lastMessageAt" = EXCLUDED."lastMessageAt", "serviceWindowExpiresAt" = EXCLUDED."serviceWindowExpiresAt",
      "state" = CASE WHEN "Conversation"."state" = 'RESOLVED' THEN 'OPEN'::"ConversationState" ELSE "Conversation"."state" END,
      "updatedAt" = CURRENT_TIMESTAMP RETURNING "id"`, [randomUUID(), item.workspaceId, contactId, item.channelNumberId, sentAt, expiresAt]);
  const conversationId = String(conversationResult.rows[0].id);
  const mediaData = message.type === "text" ? null : JSON.stringify(Object.fromEntries(Object.entries(message).filter(([key]) => key !== "from")));
  const insert = await client.query<Row>(`INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "messageType", "textBody", "media", "platformMessageId", "receivedAt", "createdAt")
    VALUES ($1,$2,$3,$4,$5,'INBOUND','SENT',$6,$7,$8::jsonb,$9,$10,$10) ON CONFLICT ("platformMessageId") DO NOTHING RETURNING "id"`,
  [randomUUID(), item.workspaceId, conversationId, contactId, item.channelNumberId, String(message.type ?? "unknown"), textFor(message), mediaData, message.id, sentAt]);
  const mediaObject = message.type ? message[message.type] as { id?: unknown; mime_type?: unknown; filename?: unknown; sha256?: unknown; caption?: unknown } | undefined : undefined;
  if (insert.rows.length && mediaObject && typeof mediaObject.id === "string") {
    const filename = typeof mediaObject.filename === "string" ? mediaObject.filename.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255) : `${String(message.type)}-${String(message.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    await client.query(`INSERT INTO "MessageAttachment" ("id","workspaceId","messageId","providerMediaId","filename","mimeType","sizeBytes","sha256","storageStatus","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,0,$7,'PENDING',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) ON CONFLICT ("messageId") DO NOTHING`, [randomUUID(), item.workspaceId, String(insert.rows[0].id), mediaObject.id, filename || "WhatsApp media", typeof mediaObject.mime_type === "string" ? mediaObject.mime_type : "application/octet-stream", typeof mediaObject.sha256 === "string" ? mediaObject.sha256 : null]);
  }
  if (!insert.rows.length) {
    await client.query(`UPDATE "Conversation" SET "unreadCount" = GREATEST("unreadCount" - 1, 0) WHERE "id" = $1`, [conversationId]);
  }
}

async function downloadAndStoreAttachment(attachmentId: string, token: string, mediaId: string): Promise<boolean> {
  const pool = getPostgresPool();
  const state = await pool.query<Row>(`SELECT "attemptCount" FROM "MessageAttachment" WHERE "id"=$1`, [attachmentId]);
  const attempt = Number(state.rows[0]?.attemptCount ?? 1);
  const fail = async (error: unknown): Promise<never> => {
    const summary = error instanceof Error ? error.message.slice(0, 300) : "Inbound media could not be archived.";
    const exhausted = attempt >= MAX_ATTEMPTS;
    await pool.query(`UPDATE "MessageAttachment" SET "storageStatus"='FAILED',"errorSummary"=$2,"nextAttemptAt"=CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second') END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "storageStatus"='PROCESSING'`, [attachmentId, exhausted ? `Retry limit reached: ${summary}` : summary, exhausted, retryDelaySeconds(attempt)]);
    throw error;
  };
  try {
    const version = /^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION || "") ? process.env.META_GRAPH_API_VERSION : "v26.0";
    const infoResponse = await fetch(`https://graph.facebook.com/${version}/${encodeURIComponent(mediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    const info = await infoResponse.json().catch(() => ({})) as { url?: string; mime_type?: string; file_size?: number; sha256?: string; error?: { message?: string } };
    if (!infoResponse.ok || !info.url) throw new Error(info.error?.message || "Meta did not return a media download URL.");
    if (typeof info.file_size === "number" && info.file_size > 25 * 1024 * 1024) throw new Error("This inbound attachment exceeds the CRM archive limit of 25 MB.");
    const response = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error(`Meta media download failed (HTTP ${response.status}).`);
    const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let total = 0;
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > 25 * 1024 * 1024) { await reader.cancel(); throw new Error("This inbound attachment exceeds the CRM archive limit of 25 MB."); }
      chunks.push(value);
    }
    const content = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    const digest = mediaSha256(content);
    if (info.sha256 && info.sha256.toLowerCase() !== digest) throw new Error("Downloaded media checksum did not match Meta’s checksum.");
    const scan = await scanWithClamAV(content);
    if (!scan.clean) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const attachment = await client.query<Row>(`UPDATE "MessageAttachment" SET "encryptedContent"=NULL,"storageStatus"='QUARANTINED',"malwareScanStatus"='INFECTED',"malwareScannedAt"=CURRENT_TIMESTAMP,"errorSummary"='Malware detected; file quarantined.',"nextAttemptAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 RETURNING "workspaceId"`, [attachmentId]);
        if (attachment.rows[0]) await createAdminAlert(client, { workspaceId: String(attachment.rows[0].workspaceId), dedupeKey: `media-malware:${attachmentId}`, severity: "CRITICAL", category: "MEDIA_SECURITY", title: "Inbound attachment quarantined", message: "A malware scanner detected a threat in an inbound WhatsApp attachment. The file was quarantined and is unavailable to agents. Review the attachment and security incident.", targetType: "MESSAGE_ATTACHMENT", targetId: attachmentId });
        await client.query("COMMIT");
      } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
      finally { client.release(); }
      return true;
    }
    await pool.query(`UPDATE "MessageAttachment" SET "encryptedContent"=$2,"sizeBytes"=$3,"mimeType"=COALESCE($4,"mimeType"),"sha256"=$5,"storageStatus"='STORED',"malwareScanStatus"='CLEAN',"malwareScannedAt"=CURRENT_TIMESTAMP,"errorSummary"=NULL,"nextAttemptAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [attachmentId, encryptMedia(content), content.byteLength, info.mime_type ?? null, digest]);
    return false;
  } catch (error) { return fail(error); }
}

async function scanStoredAttachment(attachmentId: string, encryptedContent: Uint8Array): Promise<boolean> {
  const pool = getPostgresPool();
  const content = decryptMedia(encryptedContent);
  const scan = await scanWithClamAV(content);
  if (!scan.clean) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const attachment = await client.query<Row>(`UPDATE "MessageAttachment" SET "encryptedContent"=NULL,"storageStatus"='QUARANTINED',"malwareScanStatus"='INFECTED',"malwareScannedAt"=CURRENT_TIMESTAMP,"errorSummary"='Malware detected; file quarantined.',"nextAttemptAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 RETURNING "workspaceId"`, [attachmentId]);
      if (attachment.rows[0]) await createAdminAlert(client, { workspaceId: String(attachment.rows[0].workspaceId), dedupeKey: `media-malware:${attachmentId}`, severity: "CRITICAL", category: "MEDIA_SECURITY", title: "Inbound attachment quarantined", message: "A malware scanner detected a threat in an inbound WhatsApp attachment. The file was quarantined and is unavailable to agents. Review the attachment and security incident.", targetType: "MESSAGE_ATTACHMENT", targetId: attachmentId });
      await client.query("COMMIT");
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
    return true;
  }
  await pool.query(`UPDATE "MessageAttachment" SET "storageStatus"='STORED',"malwareScanStatus"='CLEAN',"malwareScannedAt"=CURRENT_TIMESTAMP,"errorSummary"=NULL,"nextAttemptAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [attachmentId]);
  return false;
}

async function archiveInboundMedia(item: WebhookEventWork) {
  if (item.kind !== "message" || !item.channelNumberId) return;
  const message = item.data as MetaMessage;
  const media = message.type ? message[message.type] as { id?: unknown } | undefined : undefined;
  if (typeof media?.id !== "string") return;
  const pool = getPostgresPool();
  const attachment = await pool.query<Row>(`UPDATE "MessageAttachment" a SET "storageStatus"='PROCESSING',"attemptCount"=a."attemptCount"+1,"errorSummary"=NULL,"updatedAt"=CURRENT_TIMESTAMP
    FROM "Message" m WHERE a."messageId"=m."id" AND a."workspaceId"=$1 AND a."providerMediaId"=$2 AND m."platformMessageId"=$3 AND a."storageStatus"<>'STORED'
      AND a."attemptCount" < $4 AND COALESCE(a."nextAttemptAt",CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP RETURNING a."id"`, [item.workspaceId, media.id, message.id, MAX_ATTEMPTS]);
  if (attachment.rows[0]) {
    const token = await metaTokenForNumber(item.channelNumberId);
    if (!token) throw new Error("No active Meta token is available to retrieve this attachment.");
    await downloadAndStoreAttachment(String(attachment.rows[0].id), token, media.id);
  }
}

const allowedStatuses = new Set(["sent", "delivered", "read", "failed", "deleted"]);
async function applyStatus(client: PoolClient, item: WebhookEventWork) {
  const status = item.data as MetaStatus;
  if (!status.id || !status.status || !allowedStatuses.has(status.status)) throw new Error("WhatsApp status webhook is missing its message ID or has an unsupported status.");
  if (status.status === "deleted") return;
  const existing = await client.query<Row>(`SELECT "id", "status", "failureClass" FROM "Message" WHERE "platformMessageId" = $1 AND "workspaceId" = $2`, [status.id, item.workspaceId]);
  let existingRows = existing.rows;
  if (!existingRows.length && item.channelNumberId && typeof status.recipient_id === "string" && /^\d{6,20}$/.test(status.recipient_id) && /^\d{9,12}$/.test(String(status.timestamp ?? ""))) {
    const candidates = await client.query<Row>(`SELECT m."id",m."status",m."failureClass" FROM "Message" m JOIN "Contact" c ON c."id"=m."contactId" AND c."workspaceId"=m."workspaceId"
      WHERE m."workspaceId"=$1 AND m."channelNumberId"=$2 AND m."direction"='OUTBOUND' AND m."platformMessageId" IS NULL
        AND (m."status" IN ('QUEUED','SENDING','UNKNOWN') OR (m."status"='FAILED' AND m."failureClass"='OUTCOME_UNKNOWN'))
        AND (regexp_replace(c."primaryPhone",'\\D','','g')=$3 OR EXISTS (SELECT 1 FROM "ContactIdentifier" ci WHERE ci."workspaceId"=m."workspaceId" AND ci."contactId"=c."id" AND ci."type"='PHONE' AND regexp_replace(ci."normalizedValue",'\\D','','g')=$3))
        AND m."createdAt" BETWEEN to_timestamp($4::double precision)-INTERVAL '15 minutes' AND to_timestamp($4::double precision)+INTERVAL '5 minutes'
      ORDER BY ABS(EXTRACT(EPOCH FROM (m."createdAt"-to_timestamp($4::double precision)))) LIMIT 2 FOR UPDATE OF m`, [item.workspaceId, item.channelNumberId, status.recipient_id, status.timestamp]);
    if (candidates.rows.length === 1) {
      const correlated = await client.query<Row>(`UPDATE "Message" SET "platformMessageId"=$2 WHERE "workspaceId"=$1 AND "id"=$3 AND "platformMessageId" IS NULL RETURNING "id","status","failureClass"`, [item.workspaceId, status.id, String(candidates.rows[0].id)]);
      existingRows = correlated.rows;
    }
  }
  if (!existingRows.length) throw new Error("Message status is not correlated yet; no unique pending outbound message matched its sender, recipient, and timestamp.");
  const current = String(existingRows[0].status);
  const rank: Record<string, number> = { QUEUED: 0, SENDING: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4, UNKNOWN: 0 };
  const next = status.status.toUpperCase();
  const outcomeUnknown = String(existingRows[0].failureClass) === "OUTCOME_UNKNOWN";
  const effectiveCurrent = current === "FAILED" && outcomeUnknown ? "UNKNOWN" : current;
  if (current === "READ" || (current === "FAILED" && !outcomeUnknown) || (rank[effectiveCurrent] ?? 0) > (rank[next] ?? 0)) return;
  const errorCode = status.errors?.[0]?.code == null ? null : String(status.errors[0].code);
  const failureClass = next === "FAILED" ? classifyMetaFailure({ code: status.errors?.[0]?.code }) : null;
  const eventAt = timestamp(status.timestamp);
  await client.query(`UPDATE "Message" SET "status" = $2::"MessageStatus", "failureCode" = CASE WHEN $2 IN ('SENT','DELIVERED','READ') THEN NULL ELSE COALESCE($3,"failureCode") END,
    "failureClass" = CASE WHEN $2 = 'FAILED' THEN COALESCE($5,'UNKNOWN_HOLD') WHEN $2 IN ('SENT','DELIVERED','READ') THEN NULL ELSE "failureClass" END,
    "sentAt" = CASE WHEN $2 = 'SENT' THEN $4 ELSE "sentAt" END,
    "deliveredAt" = CASE WHEN $2 = 'DELIVERED' THEN $4 ELSE "deliveredAt" END,
    "readAt" = CASE WHEN $2 = 'READ' THEN $4 ELSE "readAt" END WHERE "id" = $1`, [String(existingRows[0].id), next, errorCode, eventAt, failureClass]);
  await client.query(`UPDATE "MessageRetry" mr SET "status"=CASE WHEN $3='FAILED' THEN 'FAILED' ELSE 'SENT' END,
      "retryMessageId"=COALESCE(mr."retryMessageId",m."id"),
      "errorSummary"=CASE WHEN $3='FAILED' THEN 'Meta reported that the retried message failed delivery.' ELSE NULL END,
      "updatedAt"=CURRENT_TIMESTAMP
    FROM "Message" m WHERE mr."workspaceId"=$1 AND m."workspaceId"=mr."workspaceId" AND m."id"=$2
      AND (mr."retryMessageId"=m."id" OR mr."idempotencyKey"=m."idempotencyKey") AND mr."status" IN ('PROCESSING','NEEDS_REVIEW')`, [item.workspaceId, String(existingRows[0].id), next]);
  if (next === "FAILED") {
    const guidance = metaFailureGuidance(failureClass ?? "UNKNOWN_HOLD");
    const message = await client.query<Row>(`SELECT "contactId" FROM "Message" WHERE "id"=$1`, [String(existingRows[0].id)]);
    await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `message-failure:${String(existingRows[0].id)}`, severity: guidance.severity, category: "MESSAGE_DELIVERY", title: guidance.title, message: `${guidance.message} Provider code: ${errorCode ?? "not supplied"}.`, targetType: "CONTACT", targetId: String(message.rows[0]?.contactId ?? "") || null });
  }
}

async function applyChannelHealthEvent(client: PoolClient, item: WebhookEventWork) {
  if (item.kind === "account_update") {
    if (item.metaWabaId) await client.query(`UPDATE "ChannelNumber" SET "lastStatusEventAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "metaWabaId"=$2`, [item.workspaceId, item.metaWabaId]);
    const event = String(item.data.event ?? "").toUpperCase();
    if (["BANNED", "DISABLED", "RESTRICTED", "ACCOUNT_DISABLED"].includes(event) && item.metaWabaId) {
      await client.query(`UPDATE "ChannelNumber" SET "state" = 'RESTRICTED', "updatedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "metaWabaId" = $2`, [item.workspaceId, item.metaWabaId]);
      await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `waba-restricted:${item.metaWabaId}:${item.eventId}`, severity: "CRITICAL", category: "WHATSAPP_ACCOUNT", title: "WhatsApp business account restricted", message: "Meta reported an account-level restriction. Mapped numbers were placed in Restricted status and excluded from sending and failover. Reconnecting access does not clear this status; review the account with Meta before an administrator reactivates any number.", targetType: "WHATSAPP_BUSINESS_ACCOUNT", targetId: item.metaWabaId });
    }
    return;
  }
  if (item.kind === "quality_update") {
    const displayPhone = typeof item.data.display_phone_number === "string" ? item.data.display_phone_number : "";
    if (!displayPhone) return;
    const event = [item.data.event, item.data.current_quality_rating, item.data.current_limit].filter(Boolean).map(String).join(" · ").slice(0, 160);
    const updated = await client.query<Row>(`UPDATE "ChannelNumber" SET "qualitySignal" = $3, "lastStatusEventAt"=CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "workspaceId" = $1 AND regexp_replace("e164Number", '\\D', '', 'g') = $2 RETURNING "id"`, [item.workspaceId, displayPhone.replace(/\D/g, ""), event || "Quality update received"]);
    const rating = String(item.data.current_quality_rating ?? "").toUpperCase();
    if (["RED", "YELLOW", "LOW"].includes(rating)) await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `number-quality:${updated.rows[0]?.id ?? displayPhone}:${item.eventId}`, severity: rating === "RED" || rating === "LOW" ? "CRITICAL" : "WARNING", category: "WHATSAPP_NUMBER", title: "WhatsApp number quality warning", message: `Meta reported a ${rating.toLowerCase()} quality rating. Review number health; quality warnings do not trigger automatic failover.`, targetType: "CHANNEL_NUMBER", targetId: updated.rows[0] ? String(updated.rows[0].id) : null });
    return;
  }
  if (item.kind === "template_status_update" || item.kind === "template_quality_update") {
    if (!item.metaWabaId) throw new Error("WhatsApp template update is missing its business account ID.");
    const templateMetaId = item.data.message_template_id == null ? "" : String(item.data.message_template_id);
    const name = typeof item.data.message_template_name === "string" ? item.data.message_template_name.slice(0, 512) : "";
    const language = typeof item.data.message_template_language === "string" ? item.data.message_template_language.slice(0, 64) : "";
    if (!templateMetaId && (!name || !language)) throw new Error("WhatsApp template update has no template ID or name/language identity.");
    const templateResult = await client.query<Row>(`SELECT "id","name","language","status","qualityScore" FROM "WhatsAppTemplate" WHERE "workspaceId"=$1 AND "wabaId"=$2 AND (($3 <> '' AND "metaTemplateId"=$3) OR ($4 <> '' AND "language"=$5 AND lower("name")=lower($4))) ORDER BY CASE WHEN "metaTemplateId"=$3 AND $3<>'' THEN 0 ELSE 1 END LIMIT 1 FOR UPDATE`, [item.workspaceId, item.metaWabaId, templateMetaId, name, language]);
    let template = templateResult.rows[0];
    if (!template) {
      if (name && language) {
        const category = typeof item.data.message_template_category === "string" ? item.data.message_template_category.trim().toUpperCase().slice(0, 80) : "UNKNOWN";
        const placeholder = await client.query<Row>(`INSERT INTO "WhatsAppTemplate" ("id","workspaceId","wabaId","metaTemplateId","name","language","category","status","components","syncedAt","updatedAt")
          VALUES ($1,$2,$3,$4,$5,$6,$7,'UNKNOWN','[]'::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
          ON CONFLICT ("wabaId","name","language") DO NOTHING
          RETURNING "id","name","language","status","qualityScore"`, [randomUUID(), item.workspaceId, item.metaWabaId, templateMetaId || null, name, language, category]);
        template = placeholder.rows[0] ?? (await client.query<Row>(`SELECT "id","name","language","status","qualityScore" FROM "WhatsAppTemplate" WHERE "workspaceId"=$1 AND "wabaId"=$2 AND "name"=$3 AND "language"=$4 FOR UPDATE`, [item.workspaceId, item.metaWabaId, name, language])).rows[0];
      }
      if (!template) {
        await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `template-unmatched:${item.eventId}`, severity: "WARNING", category: "WHATSAPP_TEMPLATE", title: "WhatsApp template update needs review", message: `Meta sent a template update for WABA ${item.metaWabaId} that is not in the CRM template list and did not include enough identity fields to add it. Sync templates to reconcile it.`, targetType: "WHATSAPP_BUSINESS_ACCOUNT", targetId: item.metaWabaId });
        return;
      }
    }
    const templateId = String(template.id);
    if (item.kind === "template_status_update") {
      const status = typeof item.data.event === "string" ? item.data.event.trim().toUpperCase().slice(0, 80) : "";
      if (!status) throw new Error("WhatsApp template status update is missing its event status.");
      const reason = typeof item.data.reason === "string" ? item.data.reason.trim().slice(0, 500) || null : null;
      const priorStatus = String(template.status).toUpperCase();
      await client.query(`UPDATE "WhatsAppTemplate" SET "status"=$2,"statusReason"=$3,"statusUpdatedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$4`, [item.workspaceId, status, reason, templateId]);
      if (priorStatus !== status && ["REJECTED", "PAUSED", "DISABLED", "FLAGGED", "PENDING_DELETION", "DELETED"].includes(status)) {
        const reasonText = reason ? ` Meta reason: ${reason}` : "";
        await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `template-status:${item.eventId}`, severity: ["DISABLED", "DELETED"].includes(status) ? "CRITICAL" : "WARNING", category: "WHATSAPP_TEMPLATE", title: `WhatsApp template ${status.toLowerCase().replaceAll("_", " ")}`, message: `${String(template.name)} (${String(template.language)}) changed to ${status}.${reasonText} Review the template in Meta and sync after resolving it.`, targetType: "WHATSAPP_TEMPLATE", targetId: templateId });
      }
      return;
    }
    const nextScore = typeof item.data.new_quality_score === "string" ? item.data.new_quality_score.trim().toUpperCase().slice(0, 32) : "";
    if (!nextScore) throw new Error("WhatsApp template quality update is missing its new quality score.");
    const priorScore = typeof item.data.previous_quality_score === "string" ? item.data.previous_quality_score.trim().toUpperCase().slice(0, 32) || null : template.qualityScore == null ? null : String(template.qualityScore);
    await client.query(`UPDATE "WhatsAppTemplate" SET "previousQualityScore"=$2,"qualityScore"=$3,"qualityUpdatedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$4`, [item.workspaceId, priorScore, nextScore, templateId]);
    if (["YELLOW", "RED"].includes(nextScore) && priorScore !== nextScore) await createAdminAlert(client, { workspaceId: item.workspaceId, dedupeKey: `template-quality:${item.eventId}`, severity: nextScore === "RED" ? "CRITICAL" : "WARNING", category: "WHATSAPP_TEMPLATE", title: `WhatsApp template quality is ${nextScore.toLowerCase()}`, message: `${String(template.name)} (${String(template.language)}) quality changed from ${priorScore ?? "unknown"} to ${nextScore}. Review customer feedback and adjust the template before sending more messages.`, targetType: "WHATSAPP_TEMPLATE", targetId: templateId });
  }
}


const MAX_ATTEMPTS = 12;
const STALE_PROCESSING_MS = 5 * 60 * 1000;
const RETRY_BASE_SECONDS = 15;

function retryDelaySeconds(attempt: number) {
  return Math.min(3600, RETRY_BASE_SECONDS * 2 ** Math.max(0, attempt - 1));
}

async function recordProcessingFailure(eventRowId: string, error: unknown) {
  const pool = getPostgresPool();
  const failure = await pool.connect();
  try {
    const state = await failure.query<Row>(`SELECT "attemptCount", "workspaceId", "eventType" FROM "WebhookEvent" WHERE "id" = $1`, [eventRowId]);
    const attempts = Number(state.rows[0]?.attemptCount ?? MAX_ATTEMPTS);
    const exhausted = attempts >= MAX_ATTEMPTS;
    const message = error instanceof Error ? error.message.slice(0, exhausted ? 350 : 500) : "Webhook processing failed.";
    await failure.query(`UPDATE "WebhookEvent" SET "processingState" = 'FAILED', "processingStartedAt" = NULL, "nextAttemptAt" = CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second') END, "errorSummary" = $2 WHERE "id" = $1`, [eventRowId, exhausted ? `Retry limit reached after ${attempts} attempts: ${message}` : message, exhausted, retryDelaySeconds(attempts)]);
    if (exhausted && state.rows[0]?.workspaceId) await createAdminAlert(failure, { workspaceId: String(state.rows[0].workspaceId), dedupeKey: `webhook-failed:${eventRowId}`, severity: "CRITICAL", category: "WEBHOOK", title: "WhatsApp webhook event needs review", message: `A ${String(state.rows[0].eventType ?? "WhatsApp")} event exhausted its retry limit. Review webhook health and retry it if appropriate.`, targetType: "WEBHOOK_EVENT", targetId: eventRowId });
  } finally { failure.release(); }
}

async function applyClaimedEvent(eventRowId: string, item: WebhookEventWork) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (item.kind === "message") await applyMessage(client, item);
    else if (item.kind === "status") await applyStatus(client, item);
    else await applyChannelHealthEvent(client, item);
    if (item.channelNumberId) await client.query(`UPDATE "ChannelNumber" SET "lastStatusEventAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [item.workspaceId, item.channelNumberId]);
    await client.query(`UPDATE "WebhookEvent" SET "processingState" = 'PROCESSED', "processedAt" = CURRENT_TIMESTAMP, "processingStartedAt" = NULL, "nextAttemptAt" = NULL, "errorSummary" = NULL WHERE "id" = $1`, [eventRowId]);
    await client.query("COMMIT");
    if (item.kind === "message") await archiveInboundMedia(item);
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

async function claimEvent(eventRowId: string) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<Row>(`SELECT "processingState", "attemptCount", "nextAttemptAt", "processingStartedAt", "errorSummary" FROM "WebhookEvent" WHERE "id" = $1 FOR UPDATE`, [eventRowId]);
    const event = result.rows[0];
    if (!event || event.processingState === "PROCESSED" || Number(event.attemptCount) >= MAX_ATTEMPTS || event.processingState === "PROCESSING") {
      await client.query("COMMIT");
      return false;
    }
    if (event.processingState === "FAILED" && event.nextAttemptAt && new Date(String(event.nextAttemptAt)).getTime() > Date.now()) {
      await client.query("COMMIT");
      return false;
    }
    const nextAttempt = Number(event.attemptCount ?? 0) + 1;
    await client.query(`UPDATE "WebhookEvent" SET "processingState" = 'PROCESSING', "processingStartedAt" = CURRENT_TIMESTAMP, "attemptCount" = $2, "errorSummary" = NULL WHERE "id" = $1`, [eventRowId, nextAttempt]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}

function eventFromStoredRow(row: Row): WebhookEventWork {
  const raw = row.rawPayload as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") throw new Error("Persisted webhook event has no recoverable payload.");
  const workspaceId = String(row.workspaceId);
  const channelNumberId = row.channelNumberId == null ? null : String(row.channelNumberId);
  const eventType = String(row.eventType);
  if (eventType === "WHATSAPP_MESSAGE") {
    if (!channelNumberId || !raw.message || typeof raw.message !== "object") throw new Error("Persisted inbound message event is incomplete.");
    return { eventId: String(row.platformEventId), workspaceId, channelNumberId, kind: "message", profileName: typeof raw.profileName === "string" ? raw.profileName : undefined, data: raw.message as MetaMessage };
  }
  if (eventType === "WHATSAPP_STATUS") {
    if (!channelNumberId || !raw.status || typeof raw.status !== "object") throw new Error("Persisted status event is incomplete.");
    return { eventId: String(row.platformEventId), workspaceId, channelNumberId, kind: "status", data: raw.status as MetaStatus };
  }
  if (eventType === "WHATSAPP_ACCOUNT_UPDATE") {
    if (typeof raw.metaWabaId !== "string" || !raw.value || typeof raw.value !== "object") throw new Error("Persisted account update is incomplete.");
    return { eventId: String(row.platformEventId), workspaceId, channelNumberId, metaWabaId: raw.metaWabaId, kind: "account_update", data: raw.value as Record<string, unknown> };
  }
  if (eventType === "WHATSAPP_QUALITY_UPDATE") {
    if (!raw.value || typeof raw.value !== "object") throw new Error("Persisted quality update is incomplete.");
    return { eventId: String(row.platformEventId), workspaceId, channelNumberId, kind: "quality_update", data: raw.value as Record<string, unknown> };
  }
  if (eventType === "WHATSAPP_TEMPLATE_STATUS_UPDATE" || eventType === "WHATSAPP_TEMPLATE_QUALITY_UPDATE") {
    if (typeof raw.metaWabaId !== "string" || !raw.value || typeof raw.value !== "object") throw new Error("Persisted WhatsApp template update is incomplete.");
    return { eventId: String(row.platformEventId), workspaceId, channelNumberId: null, metaWabaId: raw.metaWabaId, kind: eventType === "WHATSAPP_TEMPLATE_STATUS_UPDATE" ? "template_status_update" : "template_quality_update", data: raw.value as Record<string, unknown> };
  }
  throw new Error(`Unsupported persisted webhook event type: ${eventType}`);
}

export async function persistWebhookEvent(item: WebhookEventWork, payload: unknown) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  let eventRowId = "";
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO "WebhookEvent" ("id", "workspaceId", "channelNumberId", "platformEventId", "eventType", "signatureValid", "rawPayload", "processingState", "attemptCount", "nextAttemptAt")
      VALUES ($1,$2,$3,$4,$5,true,$6::jsonb,'RECEIVED',0,CURRENT_TIMESTAMP) ON CONFLICT ("platformEventId") DO NOTHING`, [randomUUID(), item.workspaceId, item.channelNumberId, item.eventId, `WHATSAPP_${item.kind.toUpperCase()}`, JSON.stringify(payload)]);
    const saved = await client.query<Row>(`SELECT "id", "processingState" FROM "WebhookEvent" WHERE "platformEventId" = $1 FOR UPDATE`, [item.eventId]);
    eventRowId = String(saved.rows[0].id);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  return eventRowId;
}

export async function persistAndProcess(item: WebhookEventWork, payload: unknown) {
  const eventRowId = await persistWebhookEvent(item, payload);
  const claimed = await claimEvent(eventRowId);
  if (!claimed) return;
  try {
    await applyClaimedEvent(eventRowId, item);
  } catch (error) {
    await recordProcessingFailure(eventRowId, error);
    throw error;
  }
}

export async function recoverPendingWebhookEvents(workspaceId: string, limit = 50, specificEventId?: string) {
  const batchSize = Math.max(1, Math.min(100, Math.floor(limit)));
  const pool = getPostgresPool();
  const claimClient = await pool.connect();
  let rows: Row[] = [];
  try {
    await claimClient.query("BEGIN");
    await claimClient.query(`UPDATE "WebhookEvent" SET "processingState" = 'FAILED', "processingStartedAt" = NULL, "nextAttemptAt" = NULL, "errorSummary" = COALESCE("errorSummary", 'Retry limit reached after a stale processing claim.')
      WHERE "workspaceId" = $3 AND "processingState" = 'PROCESSING' AND "processingStartedAt" < CURRENT_TIMESTAMP - ($1 * INTERVAL '1 millisecond') AND COALESCE("attemptCount",0) >= $2`, [STALE_PROCESSING_MS, MAX_ATTEMPTS, workspaceId]);
    const selected = await claimClient.query<Row>(`SELECT "id", "workspaceId", "channelNumberId", "platformEventId", "eventType", "rawPayload", "processingState", "attemptCount", "nextAttemptAt", "processingStartedAt", "errorSummary"
      FROM "WebhookEvent"
      WHERE "workspaceId" = $4 AND ($5::text IS NULL OR "id" = $5) AND (("processingState" IN ('RECEIVED','FAILED') AND COALESCE("nextAttemptAt", CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP AND COALESCE("attemptCount",0) < $2)
        OR ("processingState" = 'PROCESSING' AND "processingStartedAt" < CURRENT_TIMESTAMP - ($3 * INTERVAL '1 millisecond') AND COALESCE("attemptCount",0) < $2))
      ORDER BY "receivedAt" LIMIT $1 FOR UPDATE SKIP LOCKED`, [batchSize, MAX_ATTEMPTS, STALE_PROCESSING_MS, workspaceId, specificEventId ?? null]);
    rows = selected.rows;
    for (const row of rows) await claimClient.query(`UPDATE "WebhookEvent" SET "processingState" = 'PROCESSING', "processingStartedAt" = CURRENT_TIMESTAMP, "attemptCount" = "attemptCount" + 1, "errorSummary" = NULL WHERE "id" = $1`, [String(row.id)]);
    await claimClient.query("COMMIT");
  } catch (error) {
    try { await claimClient.query("ROLLBACK"); } catch {}
    throw error;
  } finally { claimClient.release(); }

  let processed = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await applyClaimedEvent(String(row.id), eventFromStoredRow(row));
      processed += 1;
    } catch (error) {
      await recordProcessingFailure(String(row.id), error);
      failed += 1;
    }
  }
  const media = specificEventId ? { claimed: 0, archived: 0, failed: 0 } : await recoverPendingMediaAttachments(workspaceId, batchSize);
  return { claimed: rows.length, processed, failed, media, maxAttempts: MAX_ATTEMPTS };
}

async function recoverPendingMediaAttachments(workspaceId: string, limit: number) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  let rows: Row[] = [];
  try {
    await client.query("BEGIN");
    await client.query(`UPDATE "MessageAttachment" SET "storageStatus"='FAILED',"errorSummary"=COALESCE("errorSummary",'Media archive or scan claim became stale.'),"nextAttemptAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "storageStatus" IN ('PROCESSING','SCANNING') AND "updatedAt" < CURRENT_TIMESTAMP - ($2 * INTERVAL '1 millisecond') AND "attemptCount" < $3`, [workspaceId, STALE_PROCESSING_MS, MAX_ATTEMPTS]);
    const selected = await client.query<Row>(`SELECT a."id",a."providerMediaId",a."encryptedContent",a."malwareScanStatus",m."channelNumberId" FROM "MessageAttachment" a JOIN "Message" m ON m."id"=a."messageId"
      WHERE a."workspaceId"=$1 AND a."providerMediaId" IS NOT NULL AND m."channelNumberId" IS NOT NULL
        AND (a."storageStatus" IN ('PENDING','FAILED') OR (a."storageStatus"='STORED' AND a."malwareScanStatus"<>'CLEAN' AND a."encryptedContent" IS NOT NULL)) AND COALESCE(a."nextAttemptAt",CURRENT_TIMESTAMP) <= CURRENT_TIMESTAMP AND a."attemptCount" < $2
      ORDER BY a."createdAt" LIMIT $3 FOR UPDATE OF a SKIP LOCKED`, [workspaceId, MAX_ATTEMPTS, limit]);
    rows = selected.rows;
    for (const row of rows) await client.query(`UPDATE "MessageAttachment" SET "storageStatus"=CASE WHEN "encryptedContent" IS NOT NULL AND "malwareScanStatus"<>'CLEAN' THEN 'SCANNING' ELSE 'PROCESSING' END,"attemptCount"="attemptCount"+1,"errorSummary"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [String(row.id)]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  let archived = 0;
  let quarantined = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      if (row.encryptedContent && String(row.malwareScanStatus) !== "CLEAN") {
        if (await scanStoredAttachment(String(row.id), row.encryptedContent as Uint8Array)) quarantined += 1;
        else archived += 1;
        continue;
      }
      const channelNumberId = String(row.channelNumberId);
      const mediaId = String(row.providerMediaId);
      const token = await metaTokenForNumber(channelNumberId);
      if (!token) throw new Error("No active Meta token is available to retrieve this attachment.");
      if (await downloadAndStoreAttachment(String(row.id), token, mediaId)) quarantined += 1;
      else archived += 1;
    } catch (error) {
      const summary = error instanceof Error ? error.message.slice(0, 300) : "Inbound media could not be archived.";
      const attempt = Number((await pool.query<Row>(`SELECT "attemptCount" FROM "MessageAttachment" WHERE "id"=$1`, [String(row.id)])).rows[0]?.attemptCount ?? 1);
      const exhausted = attempt >= MAX_ATTEMPTS;
      const current = await pool.query<Row>(`SELECT "storageStatus" FROM "MessageAttachment" WHERE "id"=$1`, [String(row.id)]);
      if (["PROCESSING", "SCANNING"].includes(String(current.rows[0]?.storageStatus))) await pool.query(`UPDATE "MessageAttachment" SET "storageStatus"='FAILED',"errorSummary"=$2,"nextAttemptAt"=CASE WHEN $3 THEN NULL ELSE CURRENT_TIMESTAMP + ($4 * INTERVAL '1 second') END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [String(row.id), exhausted ? `Retry limit reached: ${summary}` : summary, exhausted, retryDelaySeconds(attempt)]);
      failed += 1;
    }
  }
  return { claimed: rows.length, archived, quarantined, failed };
}
