import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: "This workspace is configured for Twilio webhooks only." }, { status: 410 });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: "This workspace is configured for Twilio webhooks only. Configure Twilio to use /api/webhooks/twilio." }, { status: 410 });
}
