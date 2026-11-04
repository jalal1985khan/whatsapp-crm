import { NextRequest, NextResponse } from "next/server";
import { createChannelNumber, getCrmSnapshot } from "@/lib/crm-store";
import { requireOwner } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  const snapshot = await getCrmSnapshot();
  return NextResponse.json({ numbers: snapshot.numbers }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  const body = await request.json().catch(() => null) as { label?: string; number?: string; metaPhoneNumberId?: string; metaWabaId?: string } | null;
  if (!body?.number) return NextResponse.json({ error: "Phone number is required." }, { status: 400 });
  if (typeof body.metaPhoneNumberId !== "string" || !body.metaPhoneNumberId.trim() || typeof body.metaWabaId !== "string" || !body.metaWabaId.trim()) return NextResponse.json({ error: "Manual mapping requires both an onboarded Meta phone number ID and WhatsApp Business Account ID." }, { status: 400 });
  try {
    const number = await createChannelNumber(body.label || "", body.number, body.metaPhoneNumberId, body.metaWabaId);
    return NextResponse.json({ number }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add number." }, { status: 400 });
  }
}
