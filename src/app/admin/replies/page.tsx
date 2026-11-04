import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
  return <main className="min-h-screen bg-[#f7f8f6]"><header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Admin / Saved replies</span></div><nav className="flex gap-4 text-sm text-muted-foreground"><Link href="/admin/numbers" className="hover:text-foreground">Numbers</Link><Link href="/admin/team" className="hover:text-foreground">Team</Link><Link href="/admin/templates" className="hover:text-foreground">Templates</Link><Link href="/" className="hover:text-foreground">Inbox</Link></nav></header><div className="mx-auto max-w-5xl px-5 py-8 md:px-8"><Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to administration</Link><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Saved replies</h1><p className="mt-1 text-sm text-muted-foreground">Create approved team-wide reply snippets for agents to insert into the composer.</p></div><CannedReplyAdmin initialReplies={replies} setupError={setupError} /></div></main>;
}
