import { NextRequest, NextResponse } from "next/server";
import { hasOwner, registerOwner } from "@/lib/crm-store";
import { createSession, loginRateLimit, recordLoginFailure } from "@/lib/auth";
import { createOwnerSetupInvitation } from "@/lib/team-invitations";
import { timingSafeEqual } from "node:crypto";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (await hasOwner()) return NextResponse.json({ error: "Owner setup is already complete." }, { status: 409 });
  const body = await request.json().catch(() => null) as { email?: string; password?: string; name?: string; bootstrapSecret?: string } | null;
  if (!body || typeof body.email !== "string" || typeof body.name !== "string" || !body.email || !body.name || body.name.length > 120 || body.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return NextResponse.json({ error: "Enter your name and a valid email address." }, { status: 400 });

  if (process.env.DATABASE_URL) {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
    const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "unknown";
    const blockedSeconds = await loginRateLimit(body.email, sourceIp);
    if (blockedSeconds > 0) return NextResponse.json({ error: "Owner verification requests are temporarily limited. Try again later." }, { status: 429, headers: { "Retry-After": String(blockedSeconds), "Cache-Control": "no-store" } });
    await recordLoginFailure(body.email, sourceIp);
    const setupSecret = process.env.OWNER_SETUP_SECRET;
    if (process.env.NODE_ENV === "production") {
      if (!setupSecret || setupSecret.length < 32) return NextResponse.json({ error: "Secure owner setup is not configured. Ask your system administrator to set an OWNER_SETUP_SECRET of at least 32 characters." }, { status: 503 });
      if (body.bootstrapSecret != null && typeof body.bootstrapSecret !== "string") return NextResponse.json({ error: "Owner setup details could not be verified." }, { status: 401 });
      const supplied = Buffer.from(body.bootstrapSecret || ""); const expected = Buffer.from(setupSecret);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return NextResponse.json({ error: "Owner setup details could not be verified." }, { status: 401 });
    }
    try {
      await createOwnerSetupInvitation({ email: body.email, name: body.name });
      return NextResponse.json({ verificationRequired: true }, { status: 202, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Owner verification could not be sent." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }

  if (typeof body.password !== "string" || !body.password) return NextResponse.json({ error: "Choose a password for the local development account." }, { status: 400 });
  if (body.password.length < 12) return NextResponse.json({ error: "Use a password with at least 12 characters." }, { status: 400 });
  let owner;
  try {
    owner = await registerOwner(body.email, body.password, body.name);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Owner setup failed." }, { status: 409 });
  }
  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "";
  await createSession(owner.email, owner.name, owner.role, { sourceIp, userAgent: request.headers.get("user-agent") ?? "" });
  return NextResponse.json({ user: owner }, { status: 201 });
}
