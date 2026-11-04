import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { addInternalNote } from "@/lib/crm-store";
import { canAccessContactRecord } from "@/lib/inbox-access";
import { getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to add an internal note." }, { status: 401 });
  const { id } = await context.params;
  if (!(await canAccessContactRecord(session, id))) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as { text?: string } | null;
  if (!body?.text?.trim()) return NextResponse.json({ error: "Write a note before saving." }, { status: 400 });
  try {
    const result = await addInternalNote(id, body.text, session.name);
    const chat = (await getScopedInboxSnapshot(session, [id])).chats.find((item) => item.id === id);
    return NextResponse.json({ chat, note: result.note }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the note." }, { status: 400 });
  }
}
