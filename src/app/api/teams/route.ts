import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;

async function membersForTeam(teamId: string) {
  const rows = await getPostgresPool().query<Row>(`SELECT u."id",u."name",u."email",wu."role" FROM "TeamMembership" tm JOIN "WorkspaceUser" wu ON wu."workspaceId"=tm."workspaceId" AND wu."userId"=tm."userId" JOIN "User" u ON u."id"=tm."userId" WHERE tm."workspaceId"=$1 AND tm."teamId"=$2 AND u."active"=true ORDER BY u."name"`, [getWorkspaceId(), teamId]);
  return rows.rows.map((row) => ({ id: String(row.id), name: String(row.name), email: String(row.email), role: String(row.role) }));
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to view teams." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ teams: [], configurable: false });
  try {
    const result = await getPostgresPool().query<Row>(`SELECT t."id",t."name",t."createdAt",t."updatedAt" FROM "Team" t WHERE t."workspaceId"=$1 AND ($2 IN ('Owner','Admin') OR EXISTS (SELECT 1 FROM "TeamMembership" tm WHERE tm."workspaceId"=t."workspaceId" AND tm."teamId"=t."id" AND tm."userId"=$3)) ORDER BY t."name"`, [getWorkspaceId(), session.role, session.userId]);
    const teams = await Promise.all(result.rows.map(async (team) => {
      const members = await membersForTeam(String(team.id));
      return { id: String(team.id), name: String(team.name), createdAt: new Date(String(team.createdAt)).toISOString(), members: session.role === "Agent" ? members.filter((member) => member.id === session.userId) : members };
    }));
    return NextResponse.json({ teams, configurable: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load teams." }, { status: 503 }); }
}

async function validateMembers(client: { query: (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }> }, workspaceId: string, memberIds: string[]) {
  const ids = [...new Set(memberIds)];
  if (!ids.length) return ids;
  const result = await client.query(`SELECT wu."userId" FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND wu."userId"=ANY($2::text[]) AND u."active"=true`, [workspaceId, ids]);
  if (result.rows.length !== ids.length) throw new Error("Choose only active members of this workspace.");
  return ids;
}

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing teams") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Team management requires PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: string; memberIds?: string[] } | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 80) : "";
  const memberIds = Array.isArray(body?.memberIds) ? body.memberIds.filter((item): item is string => typeof item === "string") : [];
  if (!name) return NextResponse.json({ error: "Team name is required." }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const ids = await validateMembers(client, workspaceId, memberIds);
    const id = randomUUID();
    await client.query(`INSERT INTO "Team" ("id","workspaceId","name","createdAt","updatedAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [id, workspaceId, name]);
    for (const userId of ids) await client.query(`INSERT INTO "TeamMembership" ("teamId","userId","workspaceId","createdAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)`, [id, userId, workspaceId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,'TEAM_CREATED','TEAM',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ name, memberIds: ids })]);
    await client.query("COMMIT");
    return NextResponse.json({ team: { id, name, members: await membersForTeam(id) } }, { status: 201 });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create team." }, { status: 400 }); }
  finally { client.release(); }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing teams") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Team management requires PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { id?: string; name?: string; memberIds?: string[] } | null;
  if (!body?.id || typeof body.name !== "string" || !Array.isArray(body.memberIds) || body.memberIds.some((id) => typeof id !== "string")) return NextResponse.json({ error: "Team ID, name, and member list are required." }, { status: 400 });
  const name = body.name.trim().slice(0, 80); if (!name) return NextResponse.json({ error: "Team name is required." }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const previous = await client.query<Row>(`SELECT "id","name" FROM "Team" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE`, [workspaceId, body.id]);
    if (!previous.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Team not found." }, { status: 404 }); }
    const ids = await validateMembers(client, workspaceId, body.memberIds);
    await client.query(`UPDATE "Team" SET "name"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, body.id, name]);
    await client.query(`DELETE FROM "TeamMembership" WHERE "workspaceId"=$1 AND "teamId"=$2`, [workspaceId, body.id]);
    for (const userId of ids) await client.query(`INSERT INTO "TeamMembership" ("teamId","userId","workspaceId","createdAt") VALUES ($1,$2,$3,CURRENT_TIMESTAMP)`, [body.id, userId, workspaceId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,'TEAM_UPDATED','TEAM',$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, body.id, JSON.stringify({ name: String(previous.rows[0].name) }), JSON.stringify({ name, memberIds: ids })]);
    await client.query("COMMIT");
    return NextResponse.json({ team: { id: body.id, name, members: await membersForTeam(body.id) } });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update team." }, { status: 400 }); }
  finally { client.release(); }
}

export async function DELETE(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing teams") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Team management requires PostgreSQL." }, { status: 503 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Team ID is required." }, { status: 400 });
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const team = await client.query<Row>(`SELECT "id","name" FROM "Team" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE`, [workspaceId,id]);
    if (!team.rows[0]) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Team not found." }, { status: 404 }); }
    const usage = await client.query<Row>(`SELECT (SELECT COUNT(*) FROM "Conversation" WHERE "workspaceId"=$1 AND "assignedTeamId"=$2) + (SELECT COUNT(*) FROM "ChannelNumber" WHERE "workspaceId"=$1 AND $2=ANY("allowedTeamIds")) + (SELECT COUNT(*) FROM "RoutingRule" WHERE "workspaceId"=$1 AND "conditions"->>'teamId'=$2) AS "count"`, [workspaceId,id]);
    if (Number(usage.rows[0]?.count ?? 0) > 0) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This team is referenced by routing or conversations. Remove those assignments before deleting it." }, { status: 409 }); }
    await client.query(`DELETE FROM "Team" WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId,id]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","createdAt") VALUES ($1,$2,$3,'TEAM_DELETED','TEAM',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ name: String(team.rows[0].name) })]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true });
  } catch (error) { try { await client.query("ROLLBACK"); } catch {} return NextResponse.json({ error: error instanceof Error ? error.message : "Could not delete team." }, { status: 400 }); }
  finally { client.release(); }
}
