import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLocalConsent, type MessagingConsent } from "@/lib/crm-store";
import { canAccessContactRecord, getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to update consent." }, { status: 401 });
  const { id } = await context.params;
  if (!(await canAccessContactRecord(session, id))) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as { status?: MessagingConsent; source?: string; wordingVersion?: string } | null;
  if (!body || !["opted_in", "opted_out"].includes(body.status ?? "")) {
    return NextResponse.json({ error: "Choose a valid consent status." }, { status: 400 });
  }
  try {
    await updateLocalConsent(id, body.status as Exclude<MessagingConsent, "unknown">, body.source ?? "", session.name, body.wordingVersion ?? "");
    const chat = (await getScopedInboxSnapshot(session, [id])).chats.find((item) => item.id === id);
    return NextResponse.json({ chat });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update consent." }, { status: 400 });
  }
}
