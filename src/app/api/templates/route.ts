import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest) {
  return NextResponse.json({ error: "Template management is not enabled in the current Twilio-only release." }, { status: 410 });
}

export async function POST(_request: NextRequest) {
  return NextResponse.json({ error: "Template management is not enabled in the current Twilio-only release." }, { status: 410 });
}
