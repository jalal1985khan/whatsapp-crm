import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange, requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;
type Rule = { id: string; name: string; priority: number; prefix: string; teamId: string | null; segmentId: string | null; numberIds: string[]; enabled: boolean };

function normalize(row: Row): Rule {
  const conditions = row.conditions && typeof row.conditions === "object" ? row.conditions as Record<string, unknown> : {};
  return { id: String(row.id), name: String(row.name), priority: Number(row.priority ?? 100), prefix: typeof conditions.phonePrefix === "string" ? conditions.phonePrefix : "", teamId: typeof conditions.teamId === "string" ? conditions.teamId : null, segmentId: typeof conditions.segmentId === "string" ? conditions.segmentId : null, numberIds: Array.isArray(row.channelOrder) ? row.channelOrder.map(String) : [], enabled: Boolean(row.enabled) };
}

export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ rules: [], configurable: false });
  const [rows, segments] = await Promise.all([
    getPostgresPool().query<Row>(`SELECT "id","name","priority","conditions","channelOrder","enabled" FROM "RoutingRule" WHERE "workspaceId"=$1 ORDER BY ("conditions" ? 'segmentId') DESC,length(COALESCE("conditions"->>'phonePrefix','')) DESC,("conditions" ? 'teamId') DESC,"priority","createdAt"`, [getWorkspaceId()]),
    getPostgresPool().query<Row>(`SELECT "id","name" FROM "CustomerSegment" WHERE "workspaceId"=$1 ORDER BY "name"`, [getWorkspaceId()]),
  ]);
  return NextResponse.json({ rules: rows.rows.map(normalize), segments: segments.rows.map((row) => ({ id: String(row.id), name: String(row.name) })), configurable: true }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing routing rules") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Routing rules require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: string; prefix?: string; teamId?: string | null; segmentId?: string | null; numberIds?: string[]; enabled?: boolean } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const prefix = typeof body?.prefix === "string" ? body.prefix.replace(/\D/g, "").slice(0, 6) : "";
  const teamId = typeof body?.teamId === "string" && body.teamId ? body.teamId : null;
  const segmentId = typeof body?.segmentId === "string" && body.segmentId ? body.segmentId : null;
  const numberIds = Array.isArray(body?.numberIds) ? [...new Set(body.numberIds.filter((id): id is string => typeof id === "string"))].slice(0, 100) : [];
  if (!name || !numberIds.length || body?.enabled !== true && body?.enabled !== false) return NextResponse.json({ error: "Name, at least one sender number, and enabled state are required." }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    if (teamId) { const team = await client.query<Row>(`SELECT "id" FROM "Team" WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, teamId]); if (!team.rows[0]) throw new Error("Choose a team in this workspace."); }
    if (segmentId) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [workspaceId, segmentId]);
      const segment = await client.query<Row>(`SELECT "id" FROM "CustomerSegment" WHERE "workspaceId"=$1 AND "id"=$2 FOR KEY SHARE`, [workspaceId, segmentId]);
      if (!segment.rows[0]) throw new Error("Choose a customer segment in this workspace.");
    }
    const selected = await client.query<Row>(`SELECT "id","state","allowedTeamIds","approvedByUserId","metaPhoneNumberId" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[]) FOR UPDATE`, [workspaceId, numberIds]);
    if (selected.rows.length !== numberIds.length || selected.rows.some((row) => String(row.state) !== "ACTIVE" || !row.approvedByUserId || !row.metaPhoneNumberId)) throw new Error("Rules can include only approved active sender numbers with a connected Meta phone ID in this workspace.");
    if (teamId && selected.rows.some((row) => Array.isArray(row.allowedTeamIds) && row.allowedTeamIds.length > 0 && !row.allowedTeamIds.map(String).includes(teamId))) throw new Error("A selected sender number is restricted to a different team.");
    const id = randomUUID();
    const priorityResult = await client.query<Row>(`SELECT COALESCE(MAX("priority"),0)+10 AS "priority" FROM "RoutingRule" WHERE "workspaceId"=$1`, [workspaceId]);
    await client.query(`INSERT INTO "RoutingRule" ("id","workspaceId","name","priority","conditions","channelOrder","enabled","version","updatedByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,1,$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [id, workspaceId, name, Number(priorityResult.rows[0]?.priority ?? 10), JSON.stringify({ phonePrefix: prefix, ...(teamId ? { teamId } : {}), ...(segmentId ? { segmentId } : {}) }), JSON.stringify(numberIds), body.enabled, session.userId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,'ROUTING_RULE_CREATED','ROUTING_RULE',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ name, phonePrefix: prefix, teamId, segmentId, numberIds, enabled: body.enabled })]);
    await client.query("COMMIT");
    return NextResponse.json({ rule: { id, name, prefix, teamId, segmentId, numberIds, enabled: body.enabled } }, { status: 201 });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save routing rule." }, { status: 400 });
  } finally { client.release(); }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing routing rules") }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string; enabled?: boolean } | null;
  if (!body?.id || typeof body.enabled !== "boolean") return NextResponse.json({ error: "Rule ID and enabled state are required." }, { status: 400 });
  const result = await getPostgresPool().query<Row>(`UPDATE "RoutingRule" SET "enabled"=$3,"version"="version"+1,"updatedByUserId"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id","name","conditions","channelOrder","enabled"`, [getWorkspaceId(), body.id, body.enabled, session.userId]);
  if (!result.rows[0]) return NextResponse.json({ error: "Routing rule not found." }, { status: 404 });
  await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,'ROUTING_RULE_TOGGLED','ROUTING_RULE',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, body.id, JSON.stringify({ enabled: body.enabled })]);
  return NextResponse.json({ rule: normalize(result.rows[0]) });
}

export async function DELETE(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing routing rules") }, { status: 403 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Rule ID is required." }, { status: 400 });
  const result = await getPostgresPool().query<Row>(`DELETE FROM "RoutingRule" WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id","name"`, [getWorkspaceId(), id]);
  if (!result.rows[0]) return NextResponse.json({ error: "Routing rule not found." }, { status: 404 });
  await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","createdAt") VALUES ($1,$2,$3,'ROUTING_RULE_DELETED','ROUTING_RULE',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, id, JSON.stringify({ name: String(result.rows[0].name) })]);
  return NextResponse.json({ deleted: true });
}
