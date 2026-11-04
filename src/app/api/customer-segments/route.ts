import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;
type Filters = { tag: string; source: string; ownerUserId: string; consent: "any" | "opted_in" | "opted_out" | "unknown" };

function normalizeFilters(input: unknown): Filters {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Choose at least one segment filter.");
  const value = input as Record<string, unknown>;
  const tag = typeof value.tag === "string" ? value.tag.trim() : "";
  const source = typeof value.source === "string" ? value.source.trim() : "";
  const ownerUserId = typeof value.ownerUserId === "string" ? value.ownerUserId.trim() : "";
  const consent = value.consent === "opted_in" || value.consent === "opted_out" || value.consent === "unknown" ? value.consent : "any";
  if (tag.length > 80 || source.length > 200 || ownerUserId.length > 128 || (consent === "any" && !tag && !source && !ownerUserId)) throw new Error("Add at least one filter and keep each value within its limit.");
  return { tag, source, ownerUserId, consent };
}

function serialize(row: Row) {
  const raw = row.filters && typeof row.filters === "object" && !Array.isArray(row.filters) ? row.filters as Record<string, unknown> : {};
  let filters: Filters;
  try { filters = normalizeFilters(raw); } catch { filters = { tag: "", source: "", ownerUserId: "", consent: "any" }; }
  return { id: String(row.id), name: String(row.name), filters, updatedAt: row.updatedAt };
}

function canManage(role: string) { return role === "Owner" || role === "Admin"; }

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to load customer segments." }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Only workspace admins can view customer segments used for routing." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ segments: [], persistent: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const result = await getPostgresPool().query<Row>(`SELECT "id","name","filters","updatedAt" FROM "CustomerSegment" WHERE "workspaceId"=$1 ORDER BY "name"`, [getWorkspaceId()]);
    return NextResponse.json({ segments: result.rows.map(serialize), persistent: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Customer segments are not available yet. Apply the latest database migration." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Sign in to create a customer segment." }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Only workspace admins can manage customer segments." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing customer segments used for routing") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL-backed customer segments are unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: unknown; filters?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "Give this segment a name of 1–40 characters." }, { status: 400 });
  let filters: Filters;
  try { filters = normalizeFilters(body?.filters); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Check the segment filters." }, { status: 400 }); }
  const id = randomUUID();
  try {
    const result = await getPostgresPool().query<Row>(`INSERT INTO "CustomerSegment" ("id","workspaceId","name","filters","createdByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4::jsonb,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING "id","name","filters","updatedAt"`, [id, getWorkspaceId(), name, JSON.stringify(filters), session.userId]);
    try { await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'CUSTOMER_SEGMENT_CREATED','CUSTOMER_SEGMENT',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, id, JSON.stringify({ name, filters })]); } catch {}
    return NextResponse.json({ segment: serialize(result.rows[0]) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const duplicate = (error as { code?: string })?.code === "23505";
    return NextResponse.json({ error: duplicate ? "A segment with that name already exists." : "Could not save this segment." }, { status: duplicate ? 409 : 503 });
  }
}

export async function DELETE(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Sign in to delete a customer segment." }, { status: 401 });
  if (!canManage(session.role)) return NextResponse.json({ error: "Only workspace admins can manage customer segments." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing customer segments used for routing") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL-backed customer segments are unavailable." }, { status: 503 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.length > 128) return NextResponse.json({ error: "Choose a customer segment." }, { status: 400 });
  const client = await getPostgresPool().connect();
  const workspaceId = getWorkspaceId();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [workspaceId, id]);
    const referenced = await client.query(`SELECT 1 FROM "RoutingRule" WHERE "workspaceId"=$1 AND "conditions"->>'segmentId'=$2 LIMIT 1`, [workspaceId, id]);
    if (referenced.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This segment is used by a routing rule. Update that rule before deleting the segment." }, { status: 409 }); }
    const result = await client.query<Row>(`DELETE FROM "CustomerSegment" WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id","name"`, [workspaceId, id]);
    if (!result.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Customer segment not found." }, { status: 404 }); }
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'CUSTOMER_SEGMENT_DELETED','CUSTOMER_SEGMENT',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ name: String(result.rows[0].name) })]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: "Could not delete this segment." }, { status: 503 });
  } finally { client.release(); }
}
