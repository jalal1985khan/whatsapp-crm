import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("merging customer records") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Contact merging requires PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { sourceId?: string; targetId?: string } | null;
  if (!body?.sourceId || !body.targetId || body.sourceId === body.targetId) return NextResponse.json({ error: "Choose two different customer records." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const sourceIp = (request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "").slice(0, 128) || null;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const locked = await client.query<QueryResultRow>(`SELECT "id","displayName","primaryPhone","email","source","ownerUserId","tags","customFields","suppressionState","suppressedAt","legalHoldAt","mergedIntoContactId" FROM "Contact" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) ORDER BY "id" FOR UPDATE`, [workspaceId, [body.sourceId, body.targetId]]);
    if (locked.rows.length !== 2) throw new Error("One of the customer records was not found in this workspace.");
    const source = locked.rows.find((row) => String(row.id) === body.sourceId)!;
    const target = locked.rows.find((row) => String(row.id) === body.targetId)!;
    if (source.mergedIntoContactId) throw new Error("This source record was already merged.");
    if (target.mergedIntoContactId) throw new Error("Choose an active customer record as the merge target.");
    if (source.legalHoldAt || target.legalHoldAt) throw new Error("Records on legal hold cannot be merged. Release the hold first.");

    const sourcePhone = String(source.primaryPhone);
    await client.query(`INSERT INTO "ContactIdentifier" ("id","workspaceId","contactId","type","normalizedValue","verified","source","createdAt") VALUES ($1,$2,$3,'PHONE',$4,FALSE,'CONTACT_MERGE',CURRENT_TIMESTAMP) ON CONFLICT ("contactId","type","normalizedValue") DO NOTHING`, [randomUUID(), workspaceId, body.targetId, sourcePhone]);
    const sourceConversations = await client.query<QueryResultRow>(`SELECT "id","channelNumberId" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 ORDER BY "id" FOR UPDATE`, [workspaceId, body.sourceId]);
    for (const oldConversation of sourceConversations.rows) {
      const oldConversationId = String(oldConversation.id);
      const existing = await client.query<QueryResultRow>(`SELECT "id" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "channelNumberId"=$3 FOR UPDATE`, [workspaceId, body.targetId, String(oldConversation.channelNumberId)]);
      if (existing.rows[0]) {
        const targetConversationId = String(existing.rows[0].id);
        await client.query(`UPDATE "Conversation" target SET "state"=CASE WHEN target."state"='OPEN' OR source."state"='OPEN' THEN 'OPEN'::"ConversationState" WHEN target."state"='WAITING' OR source."state"='WAITING' THEN 'WAITING'::"ConversationState" ELSE 'RESOLVED'::"ConversationState" END,"assignedUserId"=COALESCE(target."assignedUserId",source."assignedUserId"),"assignedTeamId"=COALESCE(target."assignedTeamId",source."assignedTeamId"),"unreadCount"=target."unreadCount"+source."unreadCount","lastMessageAt"=GREATEST(target."lastMessageAt",source."lastMessageAt"),"serviceWindowExpiresAt"=GREATEST(target."serviceWindowExpiresAt",source."serviceWindowExpiresAt"),"updatedAt"=CURRENT_TIMESTAMP FROM "Conversation" source WHERE target."id"=$1 AND source."id"=$2`, [targetConversationId, oldConversationId]);
        await client.query(`UPDATE "Message" SET "contactId"=$3,"conversationId"=$2 WHERE "workspaceId"=$1 AND "conversationId"=$4`, [workspaceId, targetConversationId, body.targetId, oldConversationId]);
        await client.query(`UPDATE "FailoverEvent" SET "conversationId"=$2 WHERE "workspaceId"=$1 AND "conversationId"=$3`, [workspaceId, targetConversationId, oldConversationId]);
        await client.query(`DELETE FROM "Conversation" WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, oldConversationId]);
      } else {
        await client.query(`UPDATE "Message" SET "contactId"=$3 WHERE "workspaceId"=$1 AND "conversationId"=$2`, [workspaceId, oldConversationId, body.targetId]);
        await client.query(`UPDATE "Conversation" SET "contactId"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, oldConversationId, body.targetId]);
      }
    }

    await client.query(`UPDATE "InternalNote" SET "contactId"=$3 WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, body.sourceId, body.targetId]);
    await client.query(`UPDATE "ConsentRecord" SET "contactId"=$3 WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, body.sourceId, body.targetId]);
    await client.query(`DELETE FROM "ContactIdentifier" source WHERE source."workspaceId"=$1 AND source."contactId"=$2 AND EXISTS (SELECT 1 FROM "ContactIdentifier" target WHERE target."workspaceId"=$1 AND target."contactId"=$3 AND target."type"=source."type" AND target."normalizedValue"=source."normalizedValue")`, [workspaceId, body.sourceId, body.targetId]);
    await client.query(`UPDATE "ContactIdentifier" SET "contactId"=$3 WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, body.sourceId, body.targetId]);
    const messageCount = await client.query<QueryResultRow>(`SELECT COUNT(*)::int AS "count" FROM "Message" WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, body.targetId]);
    const noteCount = await client.query<QueryResultRow>(`SELECT COUNT(*)::int AS "count" FROM "InternalNote" WHERE "workspaceId"=$1 AND "contactId"=$2`, [workspaceId, body.targetId]);
    await client.query(`UPDATE "Contact" SET "email"=COALESCE(NULLIF("email",''),$3),"source"=COALESCE(NULLIF("source",''),$4),"ownerUserId"=COALESCE("ownerUserId",$5),"tags"=ARRAY(SELECT DISTINCT unnest(COALESCE("tags",'{}') || $6::text[])),"customFields"=$7::jsonb || "customFields","suppressionState"=COALESCE((SELECT consent."status"::text FROM "ConsentRecord" consent WHERE consent."workspaceId"=$1 AND consent."contactId"=$2 AND consent."channel"='WHATSAPP' AND consent."scope"='WHATSAPP_MESSAGING' ORDER BY consent."capturedAt" DESC,consent."id" DESC LIMIT 1),'UNKNOWN'),"suppressedAt"=(SELECT CASE WHEN consent."status"='OPTED_OUT' THEN consent."capturedAt" ELSE NULL END FROM "ConsentRecord" consent WHERE consent."workspaceId"=$1 AND consent."contactId"=$2 AND consent."channel"='WHATSAPP' AND consent."scope"='WHATSAPP_MESSAGING' ORDER BY consent."capturedAt" DESC,consent."id" DESC LIMIT 1),"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, body.targetId, source.email, source.source, source.ownerUserId, Array.isArray(source.tags) ? source.tags : [], JSON.stringify(source.customFields ?? {})]);
    await client.query(`UPDATE "Contact" SET "mergedIntoContactId"=$3 WHERE "workspaceId"=$1 AND "mergedIntoContactId" IN ($2,$3)`, [workspaceId, body.sourceId, body.targetId]);
    await client.query(`UPDATE "Contact" SET "mergedIntoContactId"=$3,"displayName"=$4,"email"=NULL,"source"=NULL,"ownerUserId"=NULL,"tags"='{}',"customFields"='{}'::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, body.sourceId, body.targetId, `Merged into ${String(target.displayName || target.primaryPhone)}`]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","before","after","createdAt") VALUES ($1,$2,$3,'CONTACTS_MERGED','CONTACT',$4,$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, body.targetId, sourceIp, JSON.stringify({ sourceContactId: body.sourceId, sourceName: source.displayName, sourcePhone, targetName: target.displayName, targetPhone: target.primaryPhone }), JSON.stringify({ mergedSourceId: body.sourceId, targetContactId: body.targetId, transferredMessages: Number(messageCount.rows[0]?.count ?? 0), combinedNotes: Number(noteCount.rows[0]?.count ?? 0), conversationIdsPreservedWhenNoChannelConflict: true })]);
    await client.query("COMMIT");
    return NextResponse.json({ merged: true, sourceId: body.sourceId, targetId: body.targetId });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not merge customer records." }, { status: 400 });
  } finally { client.release(); }
}
