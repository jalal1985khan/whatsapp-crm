import { NextRequest, NextResponse } from "next/server";
import { addLocalMessage } from "@/lib/crm-store";
import { getSession } from "@/lib/auth";
import { sendCloudMediaMessage, sendCloudTemplateMessage, sendCloudTextMessage } from "@/lib/meta-whatsapp";
import { metaTokenForNumber } from "@/lib/meta-credentials";
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
    const mimeType = file.type.toLowerCase();
    const limits: Record<string, number> = { "image/jpeg": 5 * 1024 * 1024, "image/png": 5 * 1024 * 1024, "video/mp4": 16 * 1024 * 1024, "audio/aac": 16 * 1024 * 1024, "audio/mp4": 16 * 1024 * 1024, "audio/mpeg": 16 * 1024 * 1024, "audio/amr": 16 * 1024 * 1024, "audio/ogg": 16 * 1024 * 1024, "application/pdf": 25 * 1024 * 1024, "text/plain": 25 * 1024 * 1024, "application/msword": 25 * 1024 * 1024, "application/vnd.ms-excel": 25 * 1024 * 1024, "application/vnd.ms-powerpoint": 25 * 1024 * 1024, "application/vnd.openxmlformats-officedocument.wordprocessingml.document": 25 * 1024 * 1024, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": 25 * 1024 * 1024, "application/vnd.openxmlformats-officedocument.presentationml.presentation": 25 * 1024 * 1024 };
    if (!limits[mimeType]) return NextResponse.json({ error: "Choose a supported JPEG/PNG image, MP4 video, WhatsApp audio type, PDF, text, Word, Excel, or PowerPoint file." }, { status: 400 });
    if (!file.size || file.size > limits[mimeType]) return NextResponse.json({ error: `This ${mimeType.startsWith("image/") ? "image" : mimeType.startsWith("audio/") ? "audio" : mimeType.startsWith("video/") ? "video" : "document"} exceeds the supported size limit.` }, { status: 413 });
    if (mimeType.startsWith("audio/") && caption) return NextResponse.json({ error: "WhatsApp audio attachments do not support captions. Remove the caption and send again." }, { status: 400 });
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Attachment sending requires PostgreSQL and an authorized Meta Cloud API connection." }, { status: 503 });
    try {
      const sent = await sendCloudMediaMessage({ contactId: chatId, senderNumberId, file: new Uint8Array(await file.arrayBuffer()), mimeType, filename: file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 255) || "attachment", caption, idempotencyKey });
      const snapshot = await getScopedInboxSnapshot(session, [chatId]); const chat = snapshot.chats.find((item) => item.id === chatId);
      return NextResponse.json({ chat, message: chat?.messages.find((item) => item.id === sent.id), delivery: "whatsapp", status: sent.status }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not send attachment.";
      return NextResponse.json({ error: message, uncertain: message.toLowerCase().includes("unknown") }, { status: message.toLowerCase().includes("unknown") ? 409 : 400 });
    }
  }
  const body = await request.json().catch(() => null) as { chatId?: string; text?: string; senderNumberId?: string; idempotencyKey?: string; type?: "text" | "template"; templateId?: string; parameters?: string[]; parameterNames?: string[] } | null;
  if (!body?.chatId || !body.senderNumberId) return NextResponse.json({ error: "Customer and sender number are required." }, { status: 400 });
  if (!(await canSendOnConversation(session, body.chatId, body.senderNumberId))) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const isTemplate = body.type === "template";
  if (isTemplate && (!body.templateId || !Array.isArray(body.parameters) || body.parameters.some((value) => typeof value !== "string") || (body.parameterNames !== undefined && (!Array.isArray(body.parameterNames) || body.parameterNames.some((value) => typeof value !== "string"))))) return NextResponse.json({ error: "Choose an approved template and provide its text values." }, { status: 400 });
  if (!isTemplate && !body.text?.trim()) return NextResponse.json({ error: "Enter a message." }, { status: 400 });
  if (!isTemplate && body.text!.trim().length > 4096) return NextResponse.json({ error: "Text messages must be 4,096 characters or fewer." }, { status: 400 });
  try {
    const accessToken = body.senderNumberId ? await metaTokenForNumber(body.senderNumberId) : null;
    if (accessToken) {
      if (!body.idempotencyKey || body.idempotencyKey.length > 128) return NextResponse.json({ error: "A message idempotency key is required for live WhatsApp sending." }, { status: 400 });
      const sent = isTemplate
        ? await sendCloudTemplateMessage({ contactId: body.chatId, senderNumberId: body.senderNumberId, templateId: body.templateId!, parameters: body.parameters!, parameterNames: body.parameterNames, idempotencyKey: body.idempotencyKey })
        : await sendCloudTextMessage({ contactId: body.chatId, senderNumberId: body.senderNumberId, text: body.text!.trim(), idempotencyKey: body.idempotencyKey });
      const snapshot = await getScopedInboxSnapshot(session, [body.chatId]);
      const chat = snapshot.chats.find((item) => item.id === body.chatId);
      return NextResponse.json({ chat, message: chat?.messages.find((item) => item.id === sent.id), delivery: "whatsapp", status: sent.status, duplicate: sent.duplicate, failedOver: sent.failedOver ?? false, transitionNoticeAttempted: sent.transitionNoticeAttempted ?? false, transitionNoticeSent: sent.transitionNoticeSent ?? false }, { headers: { "Cache-Control": "no-store" } });
    }
    if (isTemplate) return NextResponse.json({ error: "Approved template sending requires PostgreSQL and Meta Cloud API credentials." }, { status: 503 });
    const result = await addLocalMessage(body.chatId, body.text!.trim(), body.senderNumberId);
    return NextResponse.json({ ...result, delivery: "local-demo" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save message.";
    const uncertain = message.toLowerCase().includes("outcome is unknown") || message.toLowerCase().includes("pending or uncertain");
    return NextResponse.json({ error: message, uncertain }, { status: uncertain ? 409 : 400 });
  }
}
