import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { canAccessConversation } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to reroute this conversation." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Conversation rerouting requires PostgreSQL." }, { status: 503 });
  const { id: contactId } = await context.params;
  if (session.role === "Agent") return NextResponse.json({ error: "Only a supervisor or administrator can move a conversation to another WhatsApp number." }, { status: 403 });
  const body = await request.json().catch(() => null) as { sourceNumberId?: unknown; targetNumberId?: unknown } | null;
  if (typeof body?.sourceNumberId !== "string" || !body.sourceNumberId.trim() || body.sourceNumberId.length > 128) return NextResponse.json({ error: "Choose the source conversation thread to reroute." }, { status: 400 });
  if (typeof body?.targetNumberId !== "string" || !body.targetNumberId.trim() || body.targetNumberId.length > 128) return NextResponse.json({ error: "Choose a destination WhatsApp number." }, { status: 400 });
  if (!(await canAccessConversation(session, contactId, body.sourceNumberId))) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });

  const client = await getPostgresPool().connect();
  const workspaceId = getWorkspaceId();
  try {
    await client.query("BEGIN");
    const conversationResult = await client.query(`SELECT c."id",c."contactId",c."channelNumberId",c."assignedTeamId",c."assignedUserId",n."label" AS "sourceLabel",n."e164Number" AS "sourceNumber"
      FROM "Conversation" c JOIN "ChannelNumber" n ON n."id"=c."channelNumberId" AND n."workspaceId"=c."workspaceId"
      WHERE c."contactId"=$1 AND c."channelNumberId"=$2 AND c."workspaceId"=$3 FOR UPDATE OF c`, [contactId, body.sourceNumberId, workspaceId]);
    const conversation = conversationResult.rows[0];
    if (!conversation) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Conversation thread not found." }, { status: 404 }); }
    const targetResult = await client.query(`SELECT "id","label","e164Number","allowedTeamIds"
      FROM "ChannelNumber" n WHERE n."id"=$1 AND n."workspaceId"=$2 AND n."state"='ACTIVE' AND n."approvedByUserId" IS NOT NULL AND n."metaPhoneNumberId" IS NOT NULL
        AND ((n."whatsappConnectionId" IS NULL AND $3::boolean) OR EXISTS (SELECT 1 FROM "WhatsAppConnection" wc WHERE wc."id"=n."whatsappConnectionId" AND wc."workspaceId"=n."workspaceId" AND wc."status"='ACTIVE' AND (wc."tokenExpiresAt" IS NULL OR wc."tokenExpiresAt">CURRENT_TIMESTAMP)))`, [body.targetNumberId, workspaceId, Boolean(process.env.META_ACCESS_TOKEN)]);
    const target = targetResult.rows[0];
    if (!target) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Destination must be approved, active, and have a current Meta authorization in this workspace." }, { status: 400 }); }
    if (String(conversation.channelNumberId) === String(target.id)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This conversation already uses that number." }, { status: 400 }); }
    const allowedTeams = Array.isArray(target.allowedTeamIds) ? target.allowedTeamIds.map(String) : [];
    if (conversation.assignedTeamId && allowedTeams.length > 0 && !allowedTeams.includes(String(conversation.assignedTeamId))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Destination number is not permitted for this conversation’s team." }, { status: 400 }); }
    const routing = await client.query(`SELECT r."channelOrder" FROM "RoutingRule" r JOIN "Contact" c ON c."id"=$2 AND c."workspaceId"=r."workspaceId"
      WHERE r."workspaceId"=$1 AND r."enabled"=TRUE AND (COALESCE(r."conditions"->>'phonePrefix','')='' OR regexp_replace(c."primaryPhone",'\\D','','g') LIKE (r."conditions"->>'phonePrefix') || '%') AND (COALESCE(r."conditions"->>'teamId','')='' OR r."conditions"->>'teamId'=COALESCE($3,''))
        AND (COALESCE(r."conditions"->>'segmentId','')='' OR EXISTS (SELECT 1 FROM "CustomerSegment" seg WHERE seg."workspaceId"=r."workspaceId" AND seg."id"=r."conditions"->>'segmentId' AND (COALESCE(seg."filters"->>'tag','')='' OR c."tags" @> ARRAY[seg."filters"->>'tag']) AND (COALESCE(seg."filters"->>'source','')='' OR lower(COALESCE(c."source",''))=lower(seg."filters"->>'source')) AND (COALESCE(seg."filters"->>'ownerUserId','')='' OR c."ownerUserId"=seg."filters"->>'ownerUserId') AND (COALESCE(seg."filters"->>'consent','any')='any' OR COALESCE((SELECT cr."status"::text FROM "ConsentRecord" cr WHERE cr."workspaceId"=c."workspaceId" AND cr."contactId"=c."id" AND cr."channel"='WHATSAPP' AND cr."scope"='WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC,cr."id" DESC LIMIT 1),'UNKNOWN')=CASE seg."filters"->>'consent' WHEN 'opted_in' THEN 'OPTED_IN' WHEN 'opted_out' THEN 'OPTED_OUT' ELSE 'UNKNOWN' END)))
      ORDER BY (r."conditions" ? 'segmentId') DESC,length(COALESCE(r."conditions"->>'phonePrefix','')) DESC,(r."conditions" ? 'teamId') DESC,r."priority",r."createdAt" LIMIT 1`, [workspaceId, conversation.contactId, conversation.assignedTeamId ?? null]);
    if (routing.rows.length && (!Array.isArray(routing.rows[0].channelOrder) || !routing.rows[0].channelOrder.map(String).includes(String(target.id)))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Destination number is not allowed by the highest-priority routing rule for this customer." }, { status: 400 }); }

    const existing = await client.query(`SELECT "id" FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "channelNumberId"=$3 FOR UPDATE`, [workspaceId, conversation.contactId, target.id]);
    let targetConversationId: string;
    if (existing.rows[0]) {
      targetConversationId = String(existing.rows[0].id);
      await client.query(`UPDATE "Conversation" SET "state"='OPEN',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "workspaceId"=$2`, [targetConversationId, workspaceId]);
    } else {
      targetConversationId = randomUUID();
      await client.query(`INSERT INTO "Conversation" ("id","workspaceId","contactId","channelNumberId","state","assignedUserId","assignedTeamId","unreadCount","lastMessageAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'OPEN',$5,$6,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [targetConversationId, workspaceId, conversation.contactId, target.id, conversation.assignedUserId ?? null, conversation.assignedTeamId ?? null]);
    }
    const details = { sourceConversationId: String(conversation.id), destinationConversationId: targetConversationId, fromNumber: { id: String(conversation.channelNumberId), label: String(conversation.sourceLabel), number: String(conversation.sourceNumber) }, toNumber: { id: String(target.id), label: String(target.label), number: String(target.e164Number) }, method: "MANUAL", customerHistoryTransferred: false };
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,'CONVERSATION_MANUALLY_REROUTED','CONTACT',$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, conversation.contactId, JSON.stringify({ conversationId: conversation.id, channelNumberId: conversation.channelNumberId }), JSON.stringify(details)]);
    await client.query("COMMIT");
    return NextResponse.json({ conversationId: targetConversationId, details });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not reroute this conversation." }, { status: 400 });
  } finally { client.release(); }
}
