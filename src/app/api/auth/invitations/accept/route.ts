import { NextRequest, NextResponse } from "next/server";
import { acceptTeamInvitation } from "@/lib/team-invitations";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null) as { token?: string; password?: string } | null;
  if (!body?.token || !body.password) return NextResponse.json({ error: "Invitation link and password are required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  try {
    const accepted = await acceptTeamInvitation(body.token, body.password);
    if (!accepted) return NextResponse.json({ error: "This invitation is invalid, expired, or already used. Ask your administrator to send a new one." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    return NextResponse.json({ accepted: true, email: accepted.email }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not accept this invitation." }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
