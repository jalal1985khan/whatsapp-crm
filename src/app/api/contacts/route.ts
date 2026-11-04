import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { createLocalContact } from "@/lib/crm-store";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to add customers." }, { status: 401 });
  const body = await request.json().catch(() => null) as { name?: unknown; phone?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
  if (!name || !phone) return NextResponse.json({ error: "Customer name and phone number are required." }, { status: 400 });
  if (name.length > 160) return NextResponse.json({ error: "Customer name must be 160 characters or fewer." }, { status: 400 });
  try {
    return NextResponse.json({ contact: await createLocalContact(name, phone, session.userId) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add customer." }, { status: 400 });
  }
}
