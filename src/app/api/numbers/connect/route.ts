import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { createAdminAlert } from "@/lib/admin-alerts";
import { encryptMetaAccessToken } from "@/lib/meta-credentials";
import { getCrmSnapshot } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;
type GraphError = { error?: { message?: string; code?: number } };
type PhoneNumber = { id?: string; display_phone_number?: string; verified_name?: string; quality_rating?: string };
type PhoneList = { data?: PhoneNumber[]; paging?: { next?: string }; error?: { message?: string } };

const configuredGraphVersion = process.env.META_GRAPH_API_VERSION || "v26.0";
const graphVersion = /^v\d+\.\d+$/.test(configuredGraphVersion) ? configuredGraphVersion : "v26.0";

async function graphRequest(url: URL, token: string, method: "GET" | "POST" = "GET") {
  const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({})) as GraphError;
  if (!response.ok) throw new Error(data.error?.message || `Meta returned HTTP ${response.status}.`);
  return data;
}

export async function GET() {
  const session = await requireMfaForAdminChange();
  if (!session.session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  return NextResponse.json({ configured: Boolean(process.env.META_APP_ID && process.env.META_EMBEDDED_SIGNUP_CONFIG_ID && process.env.META_APP_SECRET && process.env.DATABASE_URL && (process.env.SESSION_SECRET?.length ?? 0) >= 32), appId: process.env.META_APP_ID || null, configId: process.env.META_EMBEDDED_SIGNUP_CONFIG_ID || null, graphVersion, needsMfa: session.needsMfa, mfaMessage: session.needsMfa ? mfaAdminActionMessage("connecting Meta numbers") : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const auth = await requireMfaForAdminChange();
  if (!auth.session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (auth.needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("connecting Meta numbers") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Meta number onboarding requires PostgreSQL." }, { status: 503 });
  const appId = process.env.META_APP_ID; const appSecret = process.env.META_APP_SECRET; const configId = process.env.META_EMBEDDED_SIGNUP_CONFIG_ID;
  if (!appId || !appSecret || !configId) return NextResponse.json({ error: "Set META_APP_ID, META_APP_SECRET, and META_EMBEDDED_SIGNUP_CONFIG_ID to enable Embedded Signup." }, { status: 503 });
  const body = await request.json().catch(() => null) as { code?: string; wabaId?: string } | null;
  if (!body?.code || body.code.length > 4096 || !body.wabaId || !/^\d{5,30}$/.test(body.wabaId)) return NextResponse.json({ error: "Meta did not return a valid authorization code and WhatsApp Business Account ID." }, { status: 400 });

  try {
    const exchange = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    exchange.searchParams.set("client_id", appId); exchange.searchParams.set("client_secret", appSecret); exchange.searchParams.set("code", body.code);
    const exchangeResponse = await fetch(exchange, { signal: AbortSignal.timeout(15_000) });
    const tokenResult = await exchangeResponse.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: { message?: string } };
    if (!exchangeResponse.ok) throw new Error(tokenResult.error?.message || `Meta token exchange returned HTTP ${exchangeResponse.status}.`);
    const accessToken = tokenResult.access_token;
    if (!accessToken || accessToken.length > 8192) throw new Error("Meta did not return a usable business connection token.");

    const wabaUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(body.wabaId)}`);
    wabaUrl.searchParams.set("fields", "id,name");
    const waba = await graphRequest(wabaUrl, accessToken) as { id?: string; name?: string };
    if (waba.id !== body.wabaId) throw new Error("Meta returned a different WhatsApp Business Account than the signup flow selected.");

    const phoneUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(body.wabaId)}/phone_numbers`);
    phoneUrl.searchParams.set("fields", "id,display_phone_number,verified_name,quality_rating"); phoneUrl.searchParams.set("limit", "100");
    const phoneResult = await graphRequest(phoneUrl, accessToken) as PhoneList;
    if (phoneResult.paging?.next) throw new Error("This WABA has more than 100 phone numbers. Connect it in smaller groups using separate WABAs or contact support.");
    const phones = (phoneResult.data ?? []).filter((phone) => typeof phone.id === "string" && /^\d+$/.test(phone.id) && typeof phone.display_phone_number === "string");
    if (!phones.length) throw new Error("Meta connected the business account but returned no usable phone numbers.");
    if (phones.length > 100) throw new Error("This business account has more than 100 phone numbers. Contact the administrator before connecting it.");

    const subscribeUrl = new URL(`https://graph.facebook.com/${graphVersion}/${encodeURIComponent(body.wabaId)}/subscribed_apps`);
    await graphRequest(subscribeUrl, accessToken, "POST");

    const pool = getPostgresPool(); const client = await pool.connect();
    const workspaceId = getWorkspaceId();
    const tokenExpiresAt = Number.isFinite(tokenResult.expires_in) && Number(tokenResult.expires_in) > 0 ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000) : null;
    const connected: { id: string; number: string; label: string; state: string }[] = [];
    try {
      await client.query("BEGIN");
      const encryptedToken = encryptMetaAccessToken(accessToken);
      const connection = await client.query<Row>(`INSERT INTO "WhatsAppConnection" ("id","workspaceId","wabaId","businessName","accessTokenEncrypted","tokenExpiresAt","status","createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,'ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT ("workspaceId","wabaId") DO UPDATE SET "businessName"=EXCLUDED."businessName","accessTokenEncrypted"=EXCLUDED."accessTokenEncrypted","tokenExpiresAt"=EXCLUDED."tokenExpiresAt","status"='ACTIVE',"updatedAt"=CURRENT_TIMESTAMP
        RETURNING "id"`, [randomUUID(), workspaceId, body.wabaId, typeof waba.name === "string" ? waba.name.slice(0, 160) : null, encryptedToken, tokenExpiresAt]);
      const connectionId = String(connection.rows[0].id);
      await client.query(`UPDATE "AdminAlert" SET "readAt"=COALESCE("readAt",CURRENT_TIMESTAMP),"emailAttempts"=GREATEST("emailAttempts",5),"emailNextAttemptAt"=NULL,"emailLastError"=CASE WHEN "emailSentAt" IS NULL THEN 'superseded_by_reconnection' ELSE "emailLastError" END
        WHERE "workspaceId"=$1 AND "targetType"='WHATSAPP_BUSINESS_ACCOUNT' AND "targetId"=$2 AND "category"='INTEGRATION' AND "title" IN ('WhatsApp connection authorization expired','WhatsApp connection authorization expires soon')`, [workspaceId, body.wabaId]);
      const priorityResult = await client.query<Row>(`SELECT COALESCE(MAX("routingPriority"),0)+100 AS priority FROM "ChannelNumber" WHERE "workspaceId"=$1`, [workspaceId]);
      let nextPriority = Number(priorityResult.rows[0]?.priority ?? 100);
      for (const phone of phones) {
        const digits = String(phone.display_phone_number).replace(/\D/g, "");
        if (!/^\d{8,15}$/.test(digits)) continue;
        const number = `+${digits}`; const phoneId = String(phone.id);
        const existingMeta = await client.query<Row>(`SELECT "id","workspaceId","metaWabaId","state","approvedByUserId","routingPriority" FROM "ChannelNumber" WHERE "metaPhoneNumberId"=$1 FOR UPDATE`, [phoneId]);
        let channelId: string; let state: string;
        if (existingMeta.rows.length) {
          const existing = existingMeta.rows[0];
          if (String(existing.workspaceId) !== workspaceId || (existing.metaWabaId && String(existing.metaWabaId) !== body.wabaId)) throw new Error("A phone number from this WABA is already connected to a different workspace or account.");
          channelId = String(existing.id); state = String(existing.state) === "ACTIVE" && !existing.approvedByUserId ? "PENDING" : String(existing.state);
          await client.query(`UPDATE "ChannelNumber" SET "metaWabaId"=$5,"displayName"=$2,"qualitySignal"=$3,"whatsappConnectionId"=$4,"state"=CASE WHEN "state"='ACTIVE' AND "approvedByUserId" IS NULL THEN 'PENDING'::"NumberState" ELSE "state" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [channelId, phone.verified_name?.slice(0, 160) ?? null, phone.quality_rating ?? null, connectionId, body.wabaId]);
        } else {
          const existingPhone = await client.query<Row>(`SELECT "id","metaPhoneNumberId","state","approvedByUserId" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "e164Number"=$2 FOR UPDATE`, [workspaceId, number]);
          if (existingPhone.rows.length) {
            const existing = existingPhone.rows[0];
            if (existing.metaPhoneNumberId && String(existing.metaPhoneNumberId) !== phoneId) throw new Error("A CRM number with this phone already has a different Meta phone-number ID.");
            channelId = String(existing.id); state = String(existing.state) === "ACTIVE" && !existing.approvedByUserId ? "PENDING" : String(existing.state);
            await client.query(`UPDATE "ChannelNumber" SET "metaPhoneNumberId"=$2,"metaWabaId"=$3,"displayName"=$4,"qualitySignal"=$5,"whatsappConnectionId"=$6,"state"=CASE WHEN "state"='ACTIVE' AND "approvedByUserId" IS NULL THEN 'PENDING'::"NumberState" ELSE "state" END,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [channelId, phoneId, body.wabaId, phone.verified_name?.slice(0, 160) ?? null, phone.quality_rating ?? null, connectionId]);
          } else {
            channelId = randomUUID(); state = "PENDING";
            const label = phone.verified_name?.trim().slice(0, 120) || number;
            await client.query(`INSERT INTO "ChannelNumber" ("id","workspaceId","label","displayName","e164Number","state","metaPhoneNumberId","metaWabaId","qualitySignal","whatsappConnectionId","routingPriority","createdAt","updatedAt")
              VALUES ($1,$2,$3,$4,$5,'PENDING',$6,$7,$8,$9,$10,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [channelId, workspaceId, label, phone.verified_name?.slice(0, 160) ?? null, number, phoneId, body.wabaId, phone.quality_rating ?? null, connectionId, nextPriority]);
            nextPriority += 100;
          }
        }
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'WHATSAPP_NUMBER_CONNECTED_VIA_EMBEDDED_SIGNUP','CHANNEL_NUMBER',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, auth.session.userId, channelId, JSON.stringify({ wabaId: body.wabaId, state })]);
        connected.push({ id: channelId, number, label: phone.verified_name?.trim().slice(0, 120) || number, state });
      }
      if (!connected.length) throw new Error("Meta returned phone numbers, but none had a valid international phone format.");
      const pendingApproval = connected.filter((number) => number.state === "PENDING").length;
      const reactivationNeeded = connected.filter((number) => number.state === "DISCONNECTED" || number.state === "PAUSED").length;
      const newNumbers = pendingApproval;
      const existingNumbers = connected.length - newNumbers;
      const followUp = [pendingApproval ? `${pendingApproval} new number${pendingApproval === 1 ? " needs" : "s need"} admin approval` : "", reactivationNeeded ? `${reactivationNeeded} previously approved number${reactivationNeeded === 1 ? " needs" : "s need"} reactivation` : ""].filter(Boolean).join("; ");
      await createAdminAlert(client, { workspaceId, dedupeKey: `meta-account-connected:${body.wabaId}:${Date.now()}`, severity: "INFO", category: "WHATSAPP_ACCOUNT", title: "WhatsApp business account connected", message: `Meta authorization was connected for this WABA. ${connected.length} sender record${connected.length === 1 ? " was" : "s were"} synced (${newNumbers} new, ${existingNumbers} existing); existing CRM history and local approval/activity states were preserved.${followUp ? ` ${followUp}.` : " Review sender status before routing messages."}`, targetType: "WHATSAPP_BUSINESS_ACCOUNT", targetId: body.wabaId });
      await client.query("COMMIT");
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
    const snapshot = await getCrmSnapshot();
    return NextResponse.json({ connected, numbers: snapshot.numbers }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 400) : "Meta onboarding could not be completed.";
    return NextResponse.json({ error: `Meta onboarding failed: ${message}` }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
