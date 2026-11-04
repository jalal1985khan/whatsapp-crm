import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { getPostgresPool } from "@/lib/postgres-pool";
import { verifyMetaSignature } from "@/lib/meta-whatsapp";
import { persistWebhookEvent, type WebhookEventWork } from "@/lib/whatsapp-webhook-processor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = QueryResultRow;
type MetaMessage = { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; [key: string]: unknown };
type MetaStatus = { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[]; [key: string]: unknown };

function sameSecret(a: string | undefined, b: string | null) {
  if (!a || !b) return false;
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
function eventId(value: unknown) {
  return `meta-${createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams;
  const mode = query.get("hub.mode");
  const token = query.get("hub.verify_token");
  const challenge = query.get("hub.challenge");
  if (mode === "subscribe" && challenge && sameSecret(process.env.META_WEBHOOK_VERIFY_TOKEN, token)) return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  return NextResponse.json({ error: "Webhook verification failed." }, { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > 1_000_000) return NextResponse.json({ error: "Webhook payload is too large." }, { status: 413 });
  if (!verifyMetaSignature(rawBody, request.headers.get("x-hub-signature-256"))) return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });

  let payload: { object?: string; entry?: { id?: string; time?: number; changes?: { field?: string; value?: { metadata?: { phone_number_id?: string }; display_phone_number?: string; contacts?: { wa_id?: string; profile?: { name?: string } }[]; messages?: MetaMessage[]; statuses?: MetaStatus[]; [key: string]: unknown } }[] }[] };
  try { payload = JSON.parse(rawBody) as typeof payload; }
  catch { return NextResponse.json({ error: "Webhook body must be valid JSON." }, { status: 400 }); }
  if (payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) return NextResponse.json({ error: "Unsupported webhook object." }, { status: 400 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL is required to durably receive WhatsApp webhooks." }, { status: 503 });

  const pool = getPostgresPool();
  const work: { item: WebhookEventWork; raw: unknown }[] = [];
  try {
    for (const entry of payload.entry) for (const change of entry.changes ?? []) {
      if (change.field === "message_template_status_update" || change.field === "message_template_quality_update") {
        const metaWabaId = entry.id;
        if (!metaWabaId) continue;
        const lookup = await pool.query<Row>(`SELECT "id","workspaceId" FROM "ChannelNumber" WHERE "metaWabaId"=$1 ORDER BY "routingPriority" LIMIT 1`, [metaWabaId]);
        const channel = lookup.rows[0];
        if (!channel) return NextResponse.json({ error: "Template update WABA is not associated with a CRM sender number." }, { status: 503 });
        const kind = change.field === "message_template_status_update" ? "template_status_update" : "template_quality_update";
        const item: WebhookEventWork = { eventId: eventId({ metaWabaId, field: change.field, value: change.value, time: entry.time }), workspaceId: String(channel.workspaceId), channelNumberId: null, metaWabaId, kind, data: change.value ?? {} };
        work.push({ item, raw: { metaWabaId, field: change.field, value: change.value } });
        continue;
      }
      if (change.field === "account_update") {
        const metaWabaId = entry.id;
        if (!metaWabaId) continue;
        const lookup = await pool.query<Row>(`SELECT "id", "workspaceId" FROM "ChannelNumber" WHERE "metaWabaId" = $1 ORDER BY "routingPriority" LIMIT 1`, [metaWabaId]);
        const channel = lookup.rows[0];
        if (!channel) return NextResponse.json({ error: "WABA is not associated with a CRM sender number." }, { status: 503 });
        const item: WebhookEventWork = { eventId: eventId({ metaWabaId, field: change.field, value: change.value }), workspaceId: String(channel.workspaceId), channelNumberId: null, metaWabaId, kind: "account_update", data: change.value ?? {} };
        work.push({ item, raw: { metaWabaId, field: change.field, value: change.value } });
        continue;
      }
      if (change.field === "phone_number_quality_update") {
        const displayPhone = change.value?.display_phone_number;
        if (typeof displayPhone !== "string") continue;
        const lookup = await pool.query<Row>(`SELECT "id", "workspaceId" FROM "ChannelNumber" WHERE regexp_replace("e164Number", '\\D', '', 'g') = $1 ORDER BY "routingPriority" LIMIT 1`, [displayPhone.replace(/\D/g, "")]);
        const channel = lookup.rows[0];
        if (!channel) return NextResponse.json({ error: "Quality update phone number is not associated with a CRM sender number." }, { status: 503 });
        const item: WebhookEventWork = { eventId: eventId({ displayPhone, field: change.field, value: change.value }), workspaceId: String(channel.workspaceId), channelNumberId: String(channel.id), kind: "quality_update", data: change.value ?? {} };
        work.push({ item, raw: { displayPhone, field: change.field, value: change.value } });
        continue;
      }
      if (change.field !== "messages") continue;
      const phoneId = change.value?.metadata?.phone_number_id;
      if (!phoneId) continue;
      const lookup = await pool.query<Row>(`SELECT "id", "workspaceId" FROM "ChannelNumber" WHERE "metaPhoneNumberId" = $1`, [phoneId]);
      const channel = lookup.rows[0];
      if (!channel) return NextResponse.json({ error: "Webhook phone number is not connected to a CRM sender number." }, { status: 503 });
      const workspaceId = String(channel.workspaceId);
      const channelNumberId = String(channel.id);
      for (const message of change.value?.messages ?? []) {
        const profileName = change.value?.contacts?.find((contact) => contact.wa_id === message.from)?.profile?.name;
        const item: WebhookEventWork = { eventId: eventId({ phoneId, kind: "message", id: message.id }), workspaceId, channelNumberId, kind: "message", profileName, data: message };
        work.push({ item, raw: { phoneNumberId: phoneId, message, profileName } });
      }
      for (const status of change.value?.statuses ?? []) {
        const item: WebhookEventWork = { eventId: eventId({ phoneId, kind: "status", id: status.id, status: status.status, timestamp: status.timestamp }), workspaceId, channelNumberId, kind: "status", data: status };
        work.push({ item, raw: { phoneNumberId: phoneId, status } });
      }
    }
    for (const event of work) await persistWebhookEvent(event.item, event.raw);
    return NextResponse.json({ accepted: true, persisted: work.length, processing: "queued" });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook event processing failed." }, { status: 500 });
  }
}
