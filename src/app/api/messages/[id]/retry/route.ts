import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { canSendOnConversation, getScopedInboxSnapshot } from "@/lib/inbox-access";
import { getTwilioCredentialsForNumber } from "@/lib/twilio-credentials";
import { sendTwilioTextMessage } from "@/lib/twilio-whatsapp";

export const runtime = "nodejs";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to retry a failed message." }, { status: 401 });

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "Message retry requires database storage." }, { status: 503 });
  }

  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as { senderNumberId?: string } | null;
  if (!body?.senderNumberId || typeof body.senderNumberId !== "string") {
    return NextResponse.json({ error: "Choose an active WhatsApp sender number." }, { status: 400 });
  }

  const pool = getPostgresPool();
  const workspaceId = getWorkspaceId();

  // 1. Fetch message to retry
  const messageRes = await pool.query<{ id: string; contactId: string; textBody: string; messageType: string; status: string }>(
    `SELECT "id", "contactId", "textBody", "messageType", "status" FROM "Message" WHERE "workspaceId" = $1 AND "id" = $2`,
    [workspaceId, id]
  );
  const message = messageRes.rows[0];
  if (!message) return NextResponse.json({ error: "Message not found." }, { status: 404 });

  // 2. Validate agent permission on conversation
  if (!(await canSendOnConversation(session, message.contactId, body.senderNumberId))) {
    return NextResponse.json({ error: "You do not have permission to send on this conversation." }, { status: 403 });
  }

  // 3. Verify sender number is active
  const senderNumberRes = await pool.query<{ id: string; provider: string; state: string }>(
    `SELECT "id", "provider", "state" FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "id" = $2 AND "state" = 'ACTIVE' LIMIT 1`,
    [workspaceId, body.senderNumberId]
  );
  if (!senderNumberRes.rows.length) {
    return NextResponse.json({ error: "Choose an active, approved WhatsApp number." }, { status: 400 });
  }

  const senderNumber = senderNumberRes.rows[0];

  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1);

  try {
    let retryResult: { id: string; status?: string; duplicate?: boolean; needsReview?: boolean } = { id };

    // Check if Twilio number
    const twilioCreds = await getTwilioCredentialsForNumber(body.senderNumberId);
    if (twilioCreds || senderNumber.provider === "TWILIO") {
      const retryKey = `manual-retry:${id}:${Date.now()}`;
      const sent = await sendTwilioTextMessage({
        contactId: message.contactId,
        senderNumberId: body.senderNumberId,
        text: message.textBody || "",
        idempotencyKey: retryKey,
        statusCallbackUrl: new URL("/api/webhooks/twilio/status", process.env.APP_BASE_URL || request.url).toString(),
      });
      retryResult = { id: sent.id, status: sent.status, duplicate: sent.duplicate };
    } else return NextResponse.json({ error: "This number is unavailable while Twilio only mode is enabled." }, { status: 409 });

    const snapshot = await getScopedInboxSnapshot(session, [message.contactId]);
    const sourceChat = snapshot.chats.find((chat) => chat.id === message.contactId);
    return NextResponse.json({ retry: retryResult, chat: sourceChat }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : "Could not retry this message.";
    const conflict = /already|unknown|reconciled|processing/i.test(errMsg);
    return NextResponse.json({ error: errMsg }, { status: conflict ? 409 : 400 });
  }
}
