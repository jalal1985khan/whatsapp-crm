import { NextRequest, NextResponse } from "next/server";
import { createPasswordResetRequest, invalidatePasswordResetToken, passwordResetEmailConfigured, sendPasswordResetEmail } from "@/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const genericResponse = () => NextResponse.json({ message: "If an account exists for that email, password reset instructions will arrive shortly." }, { status: 202, headers: { "Cache-Control": "no-store" } });

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: string } | null;
  if (!body?.email || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (!passwordResetEmailConfigured()) return NextResponse.json({ error: "Password reset is temporarily unavailable. Contact your workspace administrator." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const ip = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "unknown";
  try {
    const reset = await createPasswordResetRequest(body.email, ip);
    if (reset.allowed && reset.token) {
      try { await sendPasswordResetEmail(body.email.trim(), reset.token); }
      catch {
        await invalidatePasswordResetToken(reset.token).catch(() => undefined);
        console.error("Password reset email delivery failed.");
      }
    }
  } catch {
    console.error("Password reset request could not be processed.");
  }
  return genericResponse();
}
