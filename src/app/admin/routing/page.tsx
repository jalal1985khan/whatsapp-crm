import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { RoutingAdmin } from "@/components/routing-admin";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";
type Row = QueryResultRow;

export default async function RoutingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.role !== "OWNER" && session.role !== "ADMIN") redirect("/");
  let numbers: { id: string; label: string; number: string; state: string; priority: number; metaWabaId: string | null; allowedTeamIds: string[] }[] = [];
  let teams: { id: string; name: string }[] = [];
  let error = "";
  if (!process.env.DATABASE_URL) error = "Routing rules require PostgreSQL.";
  else try {
    const [numberRows, teamRows] = await Promise.all([
      getPostgresPool().query<Row>(`SELECT "id","label","e164Number","state","routingPriority","metaWabaId","allowedTeamIds" FROM "ChannelNumber" WHERE "workspaceId"=$1 ORDER BY "routingPriority","createdAt"`, [getWorkspaceId()]),
      getPostgresPool().query<Row>(`SELECT t."id",t."name" FROM "Team" t WHERE t."workspaceId"=$1 ORDER BY t."name"`, [getWorkspaceId()]),
    ]);
    numbers = numberRows.rows.map((row) => ({ id: String(row.id), label: String(row.label), number: String(row.e164Number), state: String(row.state), priority: Number(row.routingPriority), metaWabaId: row.metaWabaId == null ? null : String(row.metaWabaId), allowedTeamIds: Array.isArray(row.allowedTeamIds) ? row.allowedTeamIds.map(String) : [] }));
    teams = teamRows.rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
  } catch (cause) { error = cause instanceof Error ? cause.message : "Could not load routing settings."; }
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Routing rules</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose approved sender numbers for new conversations based on team and customer phone prefix.</p>
      </div>
      <RoutingAdmin initialNumbers={numbers} initialTeams={teams} setupError={error} />
    </div>
  );
}
