import Link from "next/link";
import { ArrowLeft, History } from "lucide-react";
import { redirect } from "next/navigation";
import { AuditLog } from "@/components/audit-log";
import { Button } from "@/components/ui/button";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-primary" />Relay CRM <span className="font-normal text-muted-foreground">/ Audit history</span></div><Link href="/"><Button variant="outline" size="sm">Back to inbox</Button></Link></header>
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8"><Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to administration</Link><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Audit history</h1><p className="mt-1 text-sm text-muted-foreground">Review administrative and customer-data changes recorded for this workspace.</p></div>{process.env.DATABASE_URL ? <AuditLog /> : <div className="rounded-xl border bg-white p-5 text-sm text-muted-foreground">Audit history is available when PostgreSQL is configured.</div>}</div>
  </main>;
}
