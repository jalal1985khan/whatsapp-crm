import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sensitiveAuditKey = /password|secret|token|credential|rawpayload|messagebody|textbody/i;
function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sensitiveAuditKey.test(key) ? "[hidden]" : redactAuditValue(nested)]));
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Audit history requires PostgreSQL." }, { status: 503 });

  const params = request.nextUrl.searchParams;
  const limit = Math.max(1, Math.min(100, Number.parseInt(params.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(params.get("offset") ?? "0", 10) || 0));
  const search = (params.get("q") ?? "").trim().slice(0, 120);
  const targetType = (params.get("targetType") ?? "").trim().slice(0, 80);
  const values: unknown[] = [getWorkspaceId()];
  const conditions = [`e."workspaceId"=$1`];
  if (search) { values.push(`%${search.replace(/[\\%_]/g, "\\$&")}%`); conditions.push(`(e."action" ILIKE $${values.length} ESCAPE '\\' OR e."targetType" ILIKE $${values.length} ESCAPE '\\' OR COALESCE(e."targetId",'') ILIKE $${values.length} ESCAPE '\\' OR COALESCE(u."name",'') ILIKE $${values.length} ESCAPE '\\' OR COALESCE(e."sourceIp",'') ILIKE $${values.length} ESCAPE '\\')`); }
  if (targetType && targetType !== "ALL") { values.push(targetType); conditions.push(`e."targetType"=$${values.length}`); }
  const where = conditions.join(" AND ");
  try {
    const pool = getPostgresPool();
    const count = await pool.query<QueryResultRow>(`SELECT COUNT(*)::int AS "total" FROM "AuditEvent" e LEFT JOIN "User" u ON u."id"=e."actorUserId" WHERE ${where}`, values);
    const pageValues = [...values, limit, offset];
    const rows = await pool.query<QueryResultRow>(`SELECT e."id",e."action",e."targetType",e."targetId",e."sourceIp",e."userAgent",e."before",e."after",e."details",e."createdAt",u."name" AS "actorName",u."email" AS "actorEmail" FROM "AuditEvent" e LEFT JOIN "User" u ON u."id"=e."actorUserId" WHERE ${where} ORDER BY e."createdAt" DESC,e."id" DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, pageValues);
    const events = rows.rows.map((row) => ({ ...row, before: redactAuditValue(row.before), after: redactAuditValue(row.after), details: redactAuditValue(row.details) }));
    return NextResponse.json({ events, total: Number(count.rows[0]?.total ?? 0), limit, offset, hasMore: offset + rows.rows.length < Number(count.rows[0]?.total ?? 0) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load audit history. Check database connectivity and migrations." }, { status: 503 });
  }
}
