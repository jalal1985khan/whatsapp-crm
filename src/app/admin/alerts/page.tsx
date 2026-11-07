import { redirect } from "next/navigation";
import { AlertEmailSettings } from "@/components/alert-email-settings";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AlertSettingsPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Alert settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Choose where critical WhatsApp operations alerts should be delivered.</p>
      </div>
      <AlertEmailSettings />
    </div>
  );
}
