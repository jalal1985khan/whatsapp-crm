import { NextRequest, NextResponse } from "next/server";
import { completePasswordReset } from "@/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: string; password?: string } | null;
  if (!body?.token || body.token.length > 128 || !body.password || body.password.length < 12 || body.password.length > 1024) {
    return NextResponse.json({ error: "Use a valid reset link and a password with at least 12 characters." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const changed = await completePasswordReset(body.token, body.password);
    if (!changed) return NextResponse.json({ error: "This password reset link is invalid or expired. Request a new one." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ changed: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Password reset is temporarily unavailable. Try again shortly." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
