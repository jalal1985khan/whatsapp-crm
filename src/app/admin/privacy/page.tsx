import { redirect } from "next/navigation";
import { RetentionManager } from "@/components/retention-manager";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function PrivacyAdminPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Privacy & retention</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage scheduled customer data retention and legal holds.</p>
      </div>
      <RetentionManager />
    </div>
  );
}
