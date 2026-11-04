import { NextRequest, NextResponse } from "next/server";
import { clearLoginFailures, clearMfaChallenge, createSession, loginRateLimit, readMfaChallenge, recordLoginFailure } from "@/lib/auth";
import { consumeMfa } from "@/lib/mfa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const challenge = await readMfaChallenge();
  if (!challenge) return NextResponse.json({ error: "Your sign-in challenge expired. Sign in again." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const body = await request.json().catch(() => null) as { code?: string } | null;
  if (!body?.code || body.code.length > 32) return NextResponse.json({ error: "Enter your authenticator or recovery code." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const clientIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "unknown";
  const blockedSeconds = await loginRateLimit(challenge.email, clientIp);
  if (blockedSeconds > 0) return NextResponse.json({ error: "Unable to verify this sign-in." }, { status: 429, headers: { "Retry-After": String(blockedSeconds), "Cache-Control": "no-store" } });
  if (!(await consumeMfa(challenge.email, body.code))) {
    await recordLoginFailure(challenge.email, clientIp);
    return NextResponse.json({ error: "That authenticator or recovery code is invalid." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearLoginFailures(challenge.email, clientIp);
  await clearMfaChallenge();
  await createSession(challenge.email, challenge.name, challenge.role, { sourceIp: clientIp, userAgent: request.headers.get("user-agent") ?? "", mfaVerified: true });
  return NextResponse.json({ signedIn: true }, { headers: { "Cache-Control": "no-store" } });
}
