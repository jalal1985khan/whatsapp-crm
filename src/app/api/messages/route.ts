import { NextRequest, NextResponse } from "next/server";
import { getCrmSnapshot } from "@/lib/crm-store";
import { getSession } from "@/lib/auth";
import { getTwilioCredentialsForNumber } from "@/lib/twilio-credentials";
import { sendTwilioTextMessage } from "@/lib/twilio-whatsapp";
import { canSendOnConversation } from "@/lib/inbox-access";
import { getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to use the inbox." }, { status: 401 });
  if (request.headers.get("content-type")?.includes("multipart/form-data")) {
    let form: FormData;
    try { form = await request.formData(); } catch { return NextResponse.json({ error: "Could not read the uploaded attachment. Choose the file again and retry." }, { status: 400 }); }
    const chatId = String(form.get("chatId") ?? ""); const senderNumberId = String(form.get("senderNumberId") ?? "");
    const idempotencyKey = String(form.get("idempotencyKey") ?? ""); const caption = String(form.get("caption") ?? "").trim();
    const file = form.get("file");
    if (!chatId || !senderNumberId || !idempotencyKey || idempotencyKey.length > 128 || !(file instanceof File)) return NextResponse.json({ error: "Customer, sender number, attachment, and send key are required." }, { status: 400 });
    if (!(await canSendOnConversation(session, chatId, senderNumberId))) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (caption.length > 1024) return NextResponse.json({ error: "Attachment captions must be 1,024 characters or fewer." }, { status: 400 });
    return NextResponse.json({ error: "Twilio media attachment sending is not enabled yet. Send a text message instead." }, { status: 501 });
  }
  const body = await request.json().catch(() => null) as { chatId?: string; text?: string; senderNumberId?: string; idempotencyKey?: string; type?: "text" | "template"; contentSid?: string; contentVariables?: Record<string, string> } | null;
  if (!body?.chatId || !body.senderNumberId) return NextResponse.json({ error: "Customer and sender number are required." }, { status: 400 });
  if (!(await canSendOnConversation(session, body.chatId, body.senderNumberId))) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const isTemplate = body.type === "template";
  if (isTemplate && (!body.contentSid || !/^HX[a-fA-F0-9]{32}$/.test(body.contentSid) || (body.contentVariables !== undefined && (!body.contentVariables || typeof body.contentVariables !== "object" || Array.isArray(body.contentVariables) || Object.values(body.contentVariables).some((value) => typeof value !== "string"))))) return NextResponse.json({ error: "Choose an approved Twilio template and provide its text values." }, { status: 400 });
  if (!isTemplate && !body.text?.trim()) return NextResponse.json({ error: "Enter a message." }, { status: 400 });
  if (!isTemplate && body.text!.trim().length > 4096) return NextResponse.json({ error: "Text messages must be 4,096 characters or fewer." }, { status: 400 });
  try {
    const twilioCreds = body.senderNumberId ? await getTwilioCredentialsForNumber(body.senderNumberId) : null;
    const sender = (await getCrmSnapshot()).numbers.find((number) => number.id === body.senderNumberId);
    const isTwilioNumber = sender?.provider === "TWILIO" || (!sender?.provider && Boolean(twilioCreds));
    if (!isTwilioNumber) return NextResponse.json({ error: "This number is not configured as a Twilio sender. Ask an administrator to add an approved Twilio number." }, { status: 409 });
    if (isTwilioNumber) {
      if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Live Twilio sending requires PostgreSQL. This message was not sent; configure the production database first." }, { status: 503 });
      if (!twilioCreds) return NextResponse.json({ error: "This sender is configured for Twilio, but its Twilio Account SID and Auth Token are unavailable. Reconnect its account in Admin → WhatsApp numbers." }, { status: 503 });
      if (!body.idempotencyKey || body.idempotencyKey.length > 128) return NextResponse.json({ error: "A message idempotency key is required for live WhatsApp sending." }, { status: 400 });
      const sent = await sendTwilioTextMessage({
        contactId: body.chatId,
        senderNumberId: body.senderNumberId,
        text: body.text?.trim(),
        ...(isTemplate ? { contentSid: body.contentSid, contentVariables: body.contentVariables ?? {} } : {}),
        idempotencyKey: body.idempotencyKey,
        statusCallbackUrl: new URL("/api/webhooks/twilio/status", process.env.APP_BASE_URL || request.nextUrl.origin).toString(),
      });
      const snapshot = await getScopedInboxSnapshot(session, [body.chatId]);
      const chat = snapshot.chats.find((item) => item.id === body.chatId);
      return NextResponse.json({
        chat,
        message: chat?.messages.find((item) => item.id === sent.id),
        delivery: "whatsapp",
        provider: "Twilio",
        status: sent.status,
        duplicate: sent.duplicate,
      }, { headers: { "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Twilio sending could not be configured for this number. This message was not sent." }, { status: 503 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save message.";
    const uncertain = message.toLowerCase().includes("outcome is unknown") || message.toLowerCase().includes("pending or uncertain");
    return NextResponse.json({ error: message, uncertain }, { status: uncertain ? 409 : 400 });
  }
}
