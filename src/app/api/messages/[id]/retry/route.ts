import { NextResponse } from "next/server";
import { getSession, mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { retryConfirmedMessage } from "@/lib/meta-whatsapp";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to retry a failed message." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required to resend a message." }, { status: 403 });
  const gate = await requireMfaForAdminChange();
  if (!gate.session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (gate.needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("retrying a failed WhatsApp message") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Message retry requires PostgreSQL and an authorized Meta Cloud API connection." }, { status: 503 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { senderNumberId?: string } | null;
  if (!body?.senderNumberId || typeof body.senderNumberId !== "string") return NextResponse.json({ error: "Choose an active WhatsApp sender number." }, { status: 400 });
  const sender = await getPostgresPool().query(`SELECT 1 FROM "ChannelNumber" n WHERE n."workspaceId"=$1 AND n."id"=$2 AND n."state"='ACTIVE' AND n."approvedByUserId" IS NOT NULL AND n."metaPhoneNumberId" IS NOT NULL
    AND ((n."whatsappConnectionId" IS NULL AND $3::boolean) OR EXISTS (SELECT 1 FROM "WhatsAppConnection" wc WHERE wc."id"=n."whatsappConnectionId" AND wc."workspaceId"=n."workspaceId" AND wc."status"='ACTIVE' AND (wc."tokenExpiresAt" IS NULL OR wc."tokenExpiresAt">CURRENT_TIMESTAMP)))`, [getWorkspaceId(), body.senderNumberId, Boolean(process.env.META_ACCESS_TOKEN)]);
  if (!sender.rows.length) return NextResponse.json({ error: "Choose an active, approved WhatsApp number with a current Meta authorization." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1);
  try {
    const message = await getPostgresPool().query<{ contactId: string }>(`SELECT "contactId" FROM "Message" WHERE "workspaceId"=$1 AND "id"=$2`, [getWorkspaceId(), id]);
    if (!message.rows[0]) return NextResponse.json({ error: "Message not found." }, { status: 404 });
    const retry = await retryConfirmedMessage({ messageId: id, senderNumberId: body.senderNumberId, actorUserId: session.userId, sourceIp, userAgent: request.headers.get("user-agent") ?? undefined });
    const snapshot = await getScopedInboxSnapshot(session, [message.rows[0].contactId]);
    const source = snapshot.chats.find((chat) => chat.messages.some((item) => item.id === id));
    return NextResponse.json({ retry, chat: source }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retry this message.";
    const conflict = /already|unknown|reconciled|processing/i.test(message);
    return NextResponse.json({ error: message }, { status: conflict ? 409 : 400 });
  }
}
