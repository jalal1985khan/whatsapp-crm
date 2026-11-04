import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  return (request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "").slice(0, 128) || null;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Sign in to manage customer privacy." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing a customer legal hold") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Customer privacy controls require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { action?: string; reason?: string } | null;
  if (!body || !["hold", "release"].includes(body.action ?? "")) return NextResponse.json({ error: "Choose place on hold or release hold." }, { status: 400 });
  if (body.action === "hold" && (!body.reason?.trim() || body.reason.trim().length > 500)) return NextResponse.json({ error: "Enter a legal-hold reason of up to 500 characters." }, { status: 400 });
  const { id } = await context.params; const pool = getPostgresPool(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const found = await client.query(`SELECT "id","legalHoldAt" FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2 FOR UPDATE`, [id, workspaceId]);
    if (!found.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Customer not found." }, { status: 404 }); }
    const isHold = body.action === "hold";
    if (!isHold && !found.rows[0].legalHoldAt) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This customer is not on legal hold." }, { status: 409 }); }
    await client.query(`UPDATE "Contact" SET "legalHoldAt"=$3,"legalHoldReason"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "workspaceId"=$2`, [id, workspaceId, isHold ? new Date() : null, isHold ? body.reason!.trim() : null]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","userAgent","details","createdAt") VALUES ($1,$2,$3,$4,'CONTACT',$5,$6,$7,$8::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, isHold ? "CONTACT_LEGAL_HOLD_PLACED" : "CONTACT_LEGAL_HOLD_RELEASED", id, clientIp(request), request.headers.get("user-agent")?.slice(0, 512) ?? null, JSON.stringify({ reason: isHold ? body.reason!.trim() : null })]);
    await client.query("COMMIT");
    return NextResponse.json({ legalHold: isHold });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update legal hold." }, { status: 503 });
  } finally { client.release(); }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Sign in to delete customer data." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("deleting customer data") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Customer deletion requires PostgreSQL." }, { status: 503 });
  const { id } = await context.params; const pool = getPostgresPool(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const found = await client.query<{ primaryPhone: string; legalHoldAt: Date | null }>(`SELECT "primaryPhone","legalHoldAt" FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2 FOR UPDATE`, [id, workspaceId]);
    if (!found.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Customer not found." }, { status: 404 }); }
    if (found.rows[0].legalHoldAt) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This customer is on legal hold. Release the hold before deletion." }, { status: 409 }); }
    const messages = await client.query<{ id: string; platformMessageId: string | null }>(`SELECT "id","platformMessageId" FROM "Message" WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, id]);
    const aliases = await client.query<{ id: string; primaryPhone: string }>(`SELECT "id","primaryPhone" FROM "Contact" WHERE "workspaceId"=$1 AND "mergedIntoContactId"=$2`, [workspaceId, id]);
    const phoneIdentifiers = await client.query<{ normalizedValue: string }>(`SELECT "normalizedValue" FROM "ContactIdentifier" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "type"='PHONE'`, [workspaceId, id]);
    const digits = found.rows[0].primaryPhone.replace(/\D/g, "");
    const identifiers = [...new Set([digits, ...aliases.rows.map((row) => row.primaryPhone.replace(/\D/g, "")), ...phoneIdentifiers.rows.map((row) => row.normalizedValue.replace(/\D/g, "")), ...messages.rows.map((row) => row.platformMessageId).filter((value): value is string => !!value)])];
    const contactIds = [id, ...aliases.rows.map((row) => row.id)];
    const messageRecordIds = messages.rows.map((row) => row.id);
    const attachments = await client.query<{ id: string }>(`SELECT "id" FROM "MessageAttachment" WHERE "workspaceId"=$1 AND "messageId"=ANY($2::text[])`, [workspaceId, messageRecordIds]);
    const attachmentIds = attachments.rows.map((row) => row.id);
    const failovers = await client.query<{ id: string }>(`SELECT f."id" FROM "FailoverEvent" f JOIN "Conversation" c ON c."id"=f."conversationId" AND c."workspaceId"=f."workspaceId" WHERE f."workspaceId"=$1 AND c."contactId"=ANY($2::text[])`, [workspaceId, contactIds]);
    const failoverIds = failovers.rows.map((row) => row.id);
    for (const identifier of identifiers) {
      await client.query(`UPDATE "WebhookEvent" SET "rawPayload"='{"redacted":true}'::jsonb,"rawPayloadRef"=NULL,"errorSummary"=NULL,"processingState"='PROCESSED',"processedAt"=COALESCE("processedAt",CURRENT_TIMESTAMP) WHERE "workspaceId"=$1 AND "rawPayload" IS NOT NULL AND (
        jsonb_path_exists("rawPayload", '$.entry[*].changes[*].value.contacts[*].wa_id ? (@ == $identifier)'::jsonpath, jsonb_build_object('identifier',$2::text)) OR
        jsonb_path_exists("rawPayload", '$.entry[*].changes[*].value.messages[*].from ? (@ == $identifier)'::jsonpath, jsonb_build_object('identifier',$2::text)) OR
        jsonb_path_exists("rawPayload", '$.entry[*].changes[*].value.statuses[*].recipient_id ? (@ == $identifier)'::jsonpath, jsonb_build_object('identifier',$2::text)) OR
        jsonb_path_exists("rawPayload", '$.entry[*].changes[*].value.messages[*].id ? (@ == $identifier)'::jsonpath, jsonb_build_object('identifier',$2::text))
      )`, [workspaceId, identifier]);
    }
    const redacted = JSON.stringify({ redactedForContactDeletion: true });
    await client.query(`UPDATE "AuditEvent" SET "targetId"=NULL,"before"=$3::jsonb,"after"=$3::jsonb,"details"=$3::jsonb WHERE "workspaceId"=$1 AND "targetType"='CONTACT' AND "targetId"=ANY($2::text[])`, [workspaceId, contactIds, redacted]);
    await client.query(`UPDATE "AuditEvent" SET "targetId"=NULL,"before"=$3::jsonb,"after"=$3::jsonb,"details"=$3::jsonb WHERE "workspaceId"=$1 AND "targetType"='MESSAGE' AND "targetId"=ANY($2::text[])`, [workspaceId, messageRecordIds, redacted]);
    await client.query(`UPDATE "AuditEvent" SET "targetId"=NULL,"before"=$3::jsonb,"after"=$3::jsonb,"details"=$3::jsonb WHERE "workspaceId"=$1 AND "targetType"='MESSAGE_ATTACHMENT' AND "targetId"=ANY($2::text[])`, [workspaceId, attachmentIds, redacted]);
    await client.query(`UPDATE "AuditEvent" SET "targetId"=NULL,"before"=$3::jsonb,"after"=$3::jsonb,"details"=$3::jsonb WHERE "workspaceId"=$1 AND "targetType"='FAILOVER_EVENT' AND "targetId"=ANY($2::text[])`, [workspaceId, failoverIds, redacted]);
    await client.query(`DELETE FROM "AdminAlert" WHERE "workspaceId"=$1 AND (("targetType"='MESSAGE_ATTACHMENT' AND "targetId"=ANY($2::text[])) OR ("targetType"='FAILOVER_EVENT' AND "targetId"=ANY($3::text[])))`, [workspaceId, attachmentIds, failoverIds]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","userAgent","details","createdAt") VALUES ($1,$2,$3,'CONTACT_DATA_DELETED','CONTACT',$4,$5,$6,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, clientIp(request), request.headers.get("user-agent")?.slice(0, 512) ?? null, JSON.stringify({ scope: "contact_and_conversation_history", webhookPayloads: "redacted", relatedAuditValues: "redacted", attachmentContents: "deleted" })]);
    await client.query(`DELETE FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2`, [id, workspaceId]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete customer data." }, { status: 503 });
  } finally { client.release(); }
}
