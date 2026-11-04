import { NextRequest, NextResponse } from "next/server";
import { destroySession, getSession, listAuthSessions, revokeAuthSessions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to manage your sessions." }, { status: 401 });
  return NextResponse.json({ sessions: await listAuthSessions(session.email, session.sid) }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to manage your sessions." }, { status: 401 });
  const body = await request.json().catch(() => null) as { sessionId?: string; revokeOthers?: boolean } | null;
  if (!body || (body.sessionId !== undefined && (typeof body.sessionId !== "string" || body.sessionId.length > 128)) || (body.revokeOthers !== undefined && typeof body.revokeOthers !== "boolean") || (body.revokeOthers !== true && typeof body.sessionId !== "string")) {
    return NextResponse.json({ error: "Choose a valid session to revoke." }, { status: 400 });
  }
  if (body.revokeOthers && body.sessionId) return NextResponse.json({ error: "Choose one session or revoke all other sessions." }, { status: 400 });
  const revoked = await revokeAuthSessions(session.email, session.sid, body.sessionId);
  const currentRevoked = body.sessionId === session.sid;
  if (currentRevoked) await destroySession();
  return NextResponse.json({ revoked, currentRevoked }, { headers: { "Cache-Control": "no-store" } });
}
