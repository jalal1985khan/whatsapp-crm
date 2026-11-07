import { Badge } from "@/components/ui/badge";
import { CustomerDirectory } from "@/components/customer-directory";
import { getSession } from "@/lib/auth";
import { getScopedCustomerDirectorySnapshot } from "@/lib/inbox-access";
import { redirect } from "next/navigation";
import { AdminSidebarLayout } from "@/components/admin-sidebar-layout";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const snapshot = await getScopedCustomerDirectorySnapshot(session);
  const canManagePrivacy = session.role === "Owner" || session.role === "Admin";
  return (
    <AdminSidebarLayout user={{ name: session.name, email: session.email, role: session.role }}>
      <div className="mx-auto max-w-6xl px-5 py-8 md:px-8">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Customers</h1>
            <p className="mt-1 text-sm text-muted-foreground">Customer records and conversation history across your WhatsApp numbers.</p>
          </div>
          <Badge variant="secondary">{snapshot.chats.length} contacts</Badge>
        </div>
        <CustomerDirectory contacts={snapshot.chats} owners={snapshot.team} canManagePrivacy={canManagePrivacy} canEditProfiles={canManagePrivacy} initialAdding={params.new === "1"} />
      </div>
    </AdminSidebarLayout>
  );
}
