import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { refreshConnectionExpiryAlerts } from "@/lib/admin-alerts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function adminSession() {
  const session = await getSession();
  return session && ["Owner", "Admin"].includes(session.role) ? session : null;
}

export async function GET() {
  if (!(await adminSession())) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ alerts: [], unreadCount: 0, configured: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try { await client.query("BEGIN"); await refreshConnectionExpiryAlerts(client); await client.query("COMMIT"); }
    catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
    const result = await pool.query(`SELECT "id","severity","category","title","message","targetType","targetId","createdAt","readAt" FROM "AdminAlert" WHERE "workspaceId"=$1 ORDER BY "createdAt" DESC LIMIT 50`, [getWorkspaceId()]);
    const count = await pool.query(`SELECT COUNT(*)::int AS count FROM "AdminAlert" WHERE "workspaceId"=$1 AND "readAt" IS NULL`, [getWorkspaceId()]);
    return NextResponse.json({ alerts: result.rows, unreadCount: Number(count.rows[0]?.count ?? 0), configured: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load alerts." }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const session = await adminSession();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Alerts require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { id?: string; markAllRead?: boolean } | null;
  if (!body || (body.markAllRead !== true && (typeof body.id !== "string" || body.id.length > 128))) return NextResponse.json({ error: "Choose an alert to mark as read." }, { status: 400 });
  const result = body.markAllRead
    ? await getPostgresPool().query(`UPDATE "AdminAlert" SET "readAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "readAt" IS NULL`, [getWorkspaceId()])
    : await getPostgresPool().query(`UPDATE "AdminAlert" SET "readAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2 AND "readAt" IS NULL`, [getWorkspaceId(), body.id]);
  return NextResponse.json({ markedRead: result.rowCount ?? 0 });
}
