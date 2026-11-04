import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Bell } from "lucide-react";
import { AlertEmailSettings } from "@/components/alert-email-settings";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AlertSettingsPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 text-primary" />Relay CRM <span className="font-normal text-muted-foreground">/ Alert settings</span></div><nav className="flex gap-4 text-sm text-muted-foreground"><Link href="/admin/numbers" className="hover:text-foreground">Numbers</Link><Link href="/admin/privacy" className="hover:text-foreground">Privacy</Link><Link href="/" className="hover:text-foreground">Inbox</Link></nav></header>
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8"><Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to channels</Link><div className="mb-6"><h1 className="text-2xl font-semibold tracking-tight">Alert settings</h1><p className="mt-1 text-sm text-muted-foreground">Choose where critical WhatsApp operations alerts should be delivered.</p></div><AlertEmailSettings /></div>
  </main>;
}
