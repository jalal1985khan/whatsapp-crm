import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { changeAccountPassword } from "@/lib/crm-store";
import { getSession, loginOwner, revokeAuthSessions } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { invalidatePasswordResetTokensForUser } from "@/lib/password-reset";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to change your password." }, { status: 401 });
  const body = await request.json().catch(() => null) as { currentPassword?: string; newPassword?: string } | null;
  if (!body?.currentPassword || !body.newPassword || body.newPassword.length < 12 || body.newPassword.length > 1024) {
    return NextResponse.json({ error: "Enter your current password and a new password with at least 12 characters." }, { status: 400 });
  }
  if (body.currentPassword === body.newPassword) return NextResponse.json({ error: "Choose a new password that differs from your current password." }, { status: 400 });
  const current = await loginOwner(session.email, body.currentPassword);
  if (!current) return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  try {
    const userId = await changeAccountPassword(session.email, body.newPassword);
    await invalidatePasswordResetTokensForUser(session.email);
    const revokedSessions = await revokeAuthSessions(session.email, session.sid);
    if (process.env.DATABASE_URL) {
      try {
        await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
          VALUES ($1,$2,$3,'AUTH_PASSWORD_CHANGED','USER',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), userId, JSON.stringify({ revokedOtherSessions: revokedSessions })]);
      } catch {}
    }
    return NextResponse.json({ changed: true, revokedOtherSessions: revokedSessions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change the password." }, { status: 503 });
  }
}
