import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { CannedReplyAdmin } from "@/components/canned-reply-admin";
import type { QueryResultRow } from "pg";

export const dynamic = "force-dynamic";

export default async function CannedRepliesPage() {
  let replies: { id: string; title: string; shortcut: string | null; body: string; sortOrder: number; isActive: boolean }[] = [];
  let setupError = "";
  if (!process.env.DATABASE_URL) setupError = "Configure PostgreSQL and apply the latest database migrations to manage saved replies.";
  else {
    try {
      const result = await getPostgresPool().query<QueryResultRow>(`SELECT "id","title","shortcut","body","sortOrder","isActive" FROM "CannedReply" WHERE "workspaceId"=$1 ORDER BY "sortOrder","title","id"`, [getWorkspaceId()]);
      replies = result.rows.map((row) => ({ id: String(row.id), title: String(row.title), shortcut: row.shortcut == null ? null : String(row.shortcut), body: String(row.body), sortOrder: Number(row.sortOrder), isActive: Boolean(row.isActive) }));
    } catch { setupError = "Saved replies are not available yet. Apply the latest database migrations."; }
  }
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Saved replies</h1>
        <p className="mt-1 text-sm text-muted-foreground">Create approved team-wide reply snippets for agents to insert into the composer.</p>
      </div>
      <CannedReplyAdmin initialReplies={replies} setupError={setupError} />
    </div>
  );
}
