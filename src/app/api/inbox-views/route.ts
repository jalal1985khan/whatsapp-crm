import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;
const tabs = new Set(["All messages", "Mine", "Unassigned", "Team", "Unread", "Failed"]);
const states = new Set(["All states", "Open", "Waiting", "Resolved"]);

function normalizeFilters(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Inbox filters are required.");
  const input = value as Record<string, unknown>;
  const query = typeof input.query === "string" ? input.query.trim() : "";
  const activeTab = typeof input.activeTab === "string" ? input.activeTab : "";
  const stateFilter = typeof input.stateFilter === "string" ? input.stateFilter : "All states";
  const numberFilter = typeof input.numberFilter === "string" ? input.numberFilter : "";
  const teamFilter = typeof input.teamFilter === "string" ? input.teamFilter : "";
  const tagFilter = typeof input.tagFilter === "string" ? input.tagFilter : "";
  const dateFrom = typeof input.dateFrom === "string" ? input.dateFrom : "";
  const dateTo = typeof input.dateTo === "string" ? input.dateTo : "";
  const validDate = (date: string) => {
    if (!date) return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  if (query.length > 200 || !tabs.has(activeTab) || !states.has(stateFilter) || numberFilter.length > 128 || teamFilter.length > 128 || tagFilter.length > 80 || !validDate(dateFrom) || !validDate(dateTo) || dateFrom && dateTo && dateFrom > dateTo) throw new Error("Check the saved inbox filters and date range.");
  return { query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo };
}

function serialize(row: Row) {
  const filters = row.filters && typeof row.filters === "object" && !Array.isArray(row.filters) ? row.filters as Record<string, unknown> : {};
  return { id: String(row.id), name: String(row.name), ...filters };
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to load saved inbox views." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ views: [], persistent: false }, { headers: { "Cache-Control": "no-store" } });
  try {
    const result = await getPostgresPool().query<Row>(`SELECT "id","name","filters" FROM "SavedInboxView" WHERE "workspaceId"=$1 AND "userId"=$2 ORDER BY "updatedAt" DESC,"name"`, [getWorkspaceId(), session.userId]);
    return NextResponse.json({ views: result.rows.map(serialize), persistent: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Saved inbox views are not available yet. Apply the latest database migration." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to save an inbox view." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL-backed inbox views are unavailable." }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: unknown; filters?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 40) return NextResponse.json({ error: "Give this view a name of 1–40 characters." }, { status: 400 });
  let filters: ReturnType<typeof normalizeFilters>;
  try { filters = normalizeFilters(body?.filters); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Check the saved filters." }, { status: 400 }); }
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [workspaceId, session.userId]);
    const duplicate = await client.query(`SELECT 1 FROM "SavedInboxView" WHERE "workspaceId"=$1 AND "userId"=$2 AND lower("name")=lower($3) LIMIT 1`, [workspaceId, session.userId, name]);
    if (duplicate.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "You already have a saved view with that name." }, { status: 409 }); }
    const count = await client.query<Row>(`SELECT COUNT(*)::int AS "count" FROM "SavedInboxView" WHERE "workspaceId"=$1 AND "userId"=$2`, [workspaceId, session.userId]);
    if (Number(count.rows[0]?.count ?? 0) >= 50) { await client.query("ROLLBACK"); return NextResponse.json({ error: "You can save up to 50 inbox views." }, { status: 409 }); }
    const id = randomUUID();
    const result = await client.query<Row>(`INSERT INTO "SavedInboxView" ("id","workspaceId","userId","name","filters","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING "id","name","filters"`, [id, workspaceId, session.userId, name, JSON.stringify(filters)]);
    await client.query("COMMIT");
    return NextResponse.json({ view: serialize(result.rows[0]) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const duplicate = (error as { code?: string })?.code === "23505";
    return NextResponse.json({ error: duplicate ? "You already have a saved view with that name." : "Could not save this inbox view." }, { status: duplicate ? 409 : 503 });
  } finally { client.release(); }
}

export async function DELETE(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to delete a saved inbox view." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "PostgreSQL-backed inbox views are unavailable." }, { status: 503 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || id.length > 128) return NextResponse.json({ error: "Choose a saved inbox view." }, { status: 400 });
  try {
    const result = await getPostgresPool().query(`DELETE FROM "SavedInboxView" WHERE "workspaceId"=$1 AND "userId"=$2 AND "id"=$3 RETURNING "id"`, [getWorkspaceId(), session.userId, id]);
    if (!result.rowCount) return NextResponse.json({ error: "Saved inbox view not found." }, { status: 404 });
    return NextResponse.json({ deleted: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not delete this inbox view." }, { status: 503 });
  }
}
