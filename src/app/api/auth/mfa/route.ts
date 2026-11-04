import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, markCurrentSessionMfaVerified, revokeAuthSessions } from "@/lib/auth";
import { beginMfa, beginMfaReplacement, confirmMfa, disableMfa, mfaStatus } from "@/lib/mfa";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to manage MFA." }, { status: 401 });
  return NextResponse.json(await mfaStatus(session.email), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to manage MFA." }, { status: 401 });
  const body = await request.json().catch(() => null) as { action?: string; code?: string } | null;
  try {
    if (body?.action === "begin") return NextResponse.json(await beginMfa(session.email), { headers: { "Cache-Control": "no-store" } });
    if (body?.action === "replace_begin" && typeof body.code === "string") {
      const setup = await beginMfaReplacement(session.email, body.code);
      if (process.env.DATABASE_URL) await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'AUTH_MFA_REPLACEMENT_STARTED','USER',$3,'{}'::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId]);
      return NextResponse.json(setup, { headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "confirm" && typeof body.code === "string") {
      const wasEnabled = (await mfaStatus(session.email)).enabled;
      const codes = await confirmMfa(session.email, body.code);
      let otherSessionsRevoked = false;
      if (session.role === "Owner" || session.role === "Admin") {
        await revokeAuthSessions(session.email, session.sid);
        await markCurrentSessionMfaVerified();
        otherSessionsRevoked = true;
      }
      if (process.env.DATABASE_URL) await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,$4,'USER',$3,'{}'::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, wasEnabled ? "AUTH_MFA_REPLACED" : "AUTH_MFA_ENABLED"]);
      return NextResponse.json({ enabled: true, recoveryCodes: codes, otherSessionsRevoked }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body?.action === "disable" && typeof body.code === "string") {
      await disableMfa(session.email, body.code);
      if (process.env.DATABASE_URL) await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'AUTH_MFA_DISABLED','USER',$3,'{}'::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId]);
      return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ error: "Choose a valid MFA action and code." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update MFA." }, { status: 400 });
  }
}
