import Link from "next/link";
import { ArrowLeft, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CustomerDirectory } from "@/components/customer-directory";
import { getSession } from "@/lib/auth";
import { getScopedCustomerDirectorySnapshot } from "@/lib/inbox-access";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ new?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const params = await searchParams;
  const snapshot = await getScopedCustomerDirectorySnapshot(session);
  const canManagePrivacy = session.role === "Owner" || session.role === "Admin";
  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><Users className="size-4" /></div><span className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Customers</span></span></div><Link href="/"><Button variant="outline" size="sm"><ArrowLeft data-icon="inline-start" />Back to inbox</Button></Link></header>
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-8"><div className="mb-6 flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">Customers</h1><p className="mt-1 text-sm text-muted-foreground">Customer records and conversation history across your WhatsApp numbers.</p></div><Badge variant="secondary">{snapshot.chats.length} contacts</Badge></div><CustomerDirectory contacts={snapshot.chats} owners={snapshot.team} canManagePrivacy={canManagePrivacy} canEditProfiles={canManagePrivacy} initialAdding={params.new === "1"} /></div>
  </main>;
}
