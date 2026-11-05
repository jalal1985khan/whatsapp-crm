import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { listTwilioAccounts, saveTwilioAccount, testTwilioConnection } from "@/lib/twilio-credentials";

export const runtime = "nodejs";

export async function GET() {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });

  try {
    const accounts = await listTwilioAccounts();
    return NextResponse.json({ accounts }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not load Twilio accounts." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });

  const body = (await request.json().catch(() => null)) as {
    friendlyName?: string;
    accountSid?: string;
    authToken?: string;
    validateOnly?: boolean;
  } | null;

  if (!body?.accountSid?.trim() || !body?.authToken?.trim()) {
    return NextResponse.json({ error: "Twilio Account SID and Auth Token are required." }, { status: 400 });
  }

  const sid = body.accountSid.trim();
  const token = body.authToken.trim();

  if (!sid.startsWith("AC") || sid.length < 30) {
    return NextResponse.json({ error: "Invalid Twilio Account SID format (must start with AC)." }, { status: 400 });
  }

  // Verify credentials with Twilio
  const check = await testTwilioConnection(sid, token);
  if (!check.ok) {
    return NextResponse.json({ error: `Twilio validation failed: ${check.error}` }, { status: 400 });
  }

  if (body.validateOnly) {
    return NextResponse.json({ ok: true, friendlyName: check.friendlyName });
  }

  try {
    const saved = await saveTwilioAccount({
      friendlyName: body.friendlyName?.trim() || check.friendlyName || `Twilio (${sid.slice(-4)})`,
      accountSid: sid,
      authToken: token,
    });
    return NextResponse.json({ account: saved }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save Twilio account." }, { status: 400 });
  }
}

