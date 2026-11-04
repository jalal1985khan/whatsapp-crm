import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Shield } from "lucide-react";
import { RetentionManager } from "@/components/retention-manager";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PrivacyAdminPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-2 text-sm font-semibold"><Shield className="size-4 text-primary" />Relay CRM <span className="font-normal text-muted-foreground">/ Privacy & retention</span></div><nav className="flex gap-4 text-sm text-muted-foreground"><Link href="/admin/numbers" className="hover:text-foreground">Numbers</Link><Link href="/admin/templates" className="hover:text-foreground">Templates</Link><Link href="/" className="hover:text-foreground">Inbox</Link></nav></header>
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8"><Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to channels</Link><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Privacy & retention</h1><p className="mt-1 text-sm text-muted-foreground">Manage scheduled customer data retention and legal holds.</p></div><RetentionManager /></div>
  </main>;
}
