import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SessionManager } from "@/components/session-manager";
import { getSession } from "@/lib/auth";
import { AdminSidebarLayout } from "@/components/admin-sidebar-layout";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  if (["Owner", "Admin"].includes(session.role)) {
    return (
      <AdminSidebarLayout user={{ name: session.name, email: session.email, role: session.role }}>
        <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Account security</h1>
            <p className="mt-1 text-sm text-muted-foreground">Review and revoke active sign-ins for your account.</p>
          </div>
          <SessionManager />
        </div>
      </AdminSidebarLayout>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f8f6]">
      <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
            <ShieldCheck className="size-4" />
          </div>
          <span className="text-sm font-semibold">
            Relay CRM <span className="font-normal text-muted-foreground">/ Account security</span>
          </span>
        </div>
        <Link href="/">
          <Button variant="outline" size="sm">
            <ArrowLeft data-icon="inline-start" />
            Back to inbox
          </Button>
        </Link>
      </header>
      <div className="mx-auto max-w-4xl px-5 py-8 md:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Account security</h1>
          <p className="mt-1 text-sm text-muted-foreground">Review and revoke active sign-ins for your account.</p>
        </div>
        <SessionManager />
      </div>
    </main>
  );
}
