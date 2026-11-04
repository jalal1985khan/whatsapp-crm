import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createSignedMediaUrl } from "@/lib/signed-media-url";
import { getScopedInboxListSnapshot, getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to access CRM data." }, { status: 401 });
  const params = new URL(request.url).searchParams;
  if (params.get("list") === "1") {
    const dateValue = (key: string) => { const value = params.get(key) ?? ""; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return ""; const date = new Date(`${value}T00:00:00Z`); return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : ""; };
    const snapshot = await getScopedInboxListSnapshot(session, {
      query: params.get("q") ?? "", tab: params.get("tab") ?? "All messages", state: params.get("state") ?? "All states",
      numberId: params.get("number") ?? "", teamId: params.get("team") ?? "", tag: params.get("tag") ?? "",
      dateFrom: dateValue("dateFrom"), dateTo: dateValue("dateTo"),
    });
    return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  const contactId = params.get("contact")?.trim();
  const snapshot = await getScopedInboxSnapshot(session, contactId ? [contactId] : undefined);
  const chats = snapshot.chats.map((chat) => ({
    ...chat,
    detailLoaded: Boolean(contactId && chat.id === contactId),
    messages: chat.messages.map((message) => message.media?.stored && message.media.messageId
      ? { ...message, media: { ...message.media, accessUrl: createSignedMediaUrl(message.media.messageId, session.userId, session.sid, session.exp) } }
      : message),
  }));
  return NextResponse.json({ ...snapshot, chats }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
