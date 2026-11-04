import { InvitationAcceptance } from "@/components/invitation-acceptance";

export const dynamic = "force-dynamic";
export const metadata = { title: "Accept invitation · Relay CRM", robots: { index: false, follow: false }, referrer: "no-referrer" as const };

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <InvitationAcceptance token={token && token.length <= 128 ? token : ""} />;
}
