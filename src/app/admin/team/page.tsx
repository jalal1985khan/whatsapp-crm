import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getCrmSnapshot } from "@/lib/crm-store";
import { TeamAdmin } from "@/components/team-admin";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const session = await getSession();
  if (!session || !["Owner", "Admin"].includes(session.role)) redirect("/login");
  const { team } = await getCrmSnapshot();
  return <TeamAdmin initialTeam={team} currentUserId={session.userId} />;
}
