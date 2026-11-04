import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminSession() {
  const session = await getSession();
  return session && ["Owner", "Admin"].includes(session.role) ? session : null;
}
function isEmail(value: string) { return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }

export async function GET() {
  if (!(await adminSession())) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Email alert settings require PostgreSQL." }, { status: 503 });
  try {
    const result = await getPostgresPool().query(`SELECT "emailAlertsEnabled","adminAlertEmails" FROM "Workspace" WHERE "id"=$1`, [getWorkspaceId()]);
    const row = result.rows[0];
    return NextResponse.json({ enabled: Boolean(row?.emailAlertsEnabled), emails: Array.isArray(row?.adminAlertEmails) ? row.adminAlertEmails : [], deliveryConfigured: Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM), schedulerConfigured: Boolean(process.env.ALERT_EMAIL_SECRET) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load email alert settings." }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Email alert settings require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { enabled?: boolean; emails?: unknown } | null;
  if (!body || typeof body.enabled !== "boolean" || !Array.isArray(body.emails) || body.emails.length > 10 || body.emails.some((value) => typeof value !== "string" || !isEmail(value.trim()))) return NextResponse.json({ error: "Provide an on/off setting and up to 10 valid email addresses." }, { status: 400 });
  const emails = [...new Set((body.emails as string[]).map((value) => value.trim().toLowerCase()))];
  if (body.enabled && (!emails.length || !process.env.RESEND_API_KEY || !process.env.PASSWORD_RESET_FROM || !process.env.APP_BASE_URL)) return NextResponse.json({ error: "Set at least one recipient and configure Resend, the sender address, and APP_BASE_URL before enabling email alerts." }, { status: 400 });
  const pool = getPostgresPool(); const workspaceId = getWorkspaceId(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const previousResult = await client.query(`SELECT "emailAlertsEnabled","adminAlertEmails" FROM "Workspace" WHERE "id"=$1 FOR UPDATE`, [workspaceId]);
    if (!previousResult.rows.length) throw new Error("Workspace not found.");
    const previous = { enabled: Boolean(previousResult.rows[0].emailAlertsEnabled), emails: previousResult.rows[0].adminAlertEmails ?? [] };
    await client.query(`UPDATE "Workspace" SET "emailAlertsEnabled"=$2,"adminAlertEmails"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [workspaceId, body.enabled, emails]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","before","after","createdAt") VALUES ($1,$2,$3,'ADMIN_EMAIL_ALERT_SETTINGS_CHANGED','WORKSPACE',$2,$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, request.headers.get("x-real-ip")?.slice(0, 128) ?? null, JSON.stringify(previous), JSON.stringify({ enabled: body.enabled, emails })]);
    await client.query("COMMIT");
    return NextResponse.json({ enabled: body.enabled, emails });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update email alert settings." }, { status: 503 }); }
  finally { client.release(); }
}
