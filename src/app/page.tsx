import { InboxApp } from "@/components/inbox-app";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getSession();
  if (!session) redirect("/login");
  let cannedReplies: { id: string; title: string; shortcut: string | null; body: string }[] = [];
  if (process.env.DATABASE_URL) {
    try {
      const result = await getPostgresPool().query<QueryResultRow>(`SELECT "id","title","shortcut","body" FROM "CannedReply" WHERE "workspaceId"=$1 AND "isActive"=TRUE ORDER BY "sortOrder","title","id" LIMIT 200`, [getWorkspaceId()]);
      cannedReplies = result.rows.map((row) => ({ id: String(row.id), title: String(row.title), shortcut: row.shortcut == null ? null : String(row.shortcut), body: String(row.body) }));
    } catch { /* Saved replies remain optional until the migration is applied. */ }
  }
  return <InboxApp user={{ id: session.userId, name: session.name, email: session.email, role: session.role }} cannedReplies={cannedReplies} />;
}
