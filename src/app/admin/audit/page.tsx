import { redirect } from "next/navigation";
import { AuditLog } from "@/components/audit-log";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Audit history</h1>
        <p className="mt-1 text-sm text-muted-foreground">Review administrative and customer-data changes recorded for this workspace.</p>
      </div>
      {process.env.DATABASE_URL ? <AuditLog /> : <div className="rounded-xl border bg-white p-5 text-sm text-muted-foreground">Audit history is available when PostgreSQL is configured.</div>}
    </div>
  );
}
