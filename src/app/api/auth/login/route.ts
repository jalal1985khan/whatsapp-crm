import { NextRequest, NextResponse } from "next/server";
import { hasOwner } from "@/lib/crm-store";
import { clearLoginFailures, createMfaChallenge, createSession, isMfaRequired, loginOwner, loginRateLimit, recordLoginFailure } from "@/lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
  if (!body?.email || !body.password || body.email.length > 254 || body.password.length > 1024 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const clientIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "unknown";
  const blockedSeconds = await loginRateLimit(body.email, clientIp);
  if (blockedSeconds > 0) return NextResponse.json({ error: "Unable to sign in with those credentials." }, { status: 429, headers: { "Retry-After": String(blockedSeconds), "Cache-Control": "no-store" } });
  if (!(await hasOwner())) return NextResponse.json({ error: "Complete first-time owner setup first." }, { status: 428 });
  const user = await loginOwner(body.email, body.password);
  if (!user) {
    await recordLoginFailure(body.email, clientIp);
    return NextResponse.json({ error: "Unable to sign in with those credentials." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  await clearLoginFailures(body.email, clientIp);
  if (await isMfaRequired(user.email, user.role)) {
    await createMfaChallenge(user);
    return NextResponse.json({ requiresMfa: true }, { headers: { "Cache-Control": "no-store" } });
  }
  await createSession(user.email, user.name, user.role, { sourceIp: clientIp, userAgent: request.headers.get("user-agent") ?? "" });
  return NextResponse.json({ user: { email: user.email, name: user.name, role: user.role } });
}
