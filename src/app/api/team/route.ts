import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange, getSession } from "@/lib/auth";
import { getTeamAdminSnapshot, updateTeamMember } from "@/lib/crm-store";
import { createTeamInvitation } from "@/lib/team-invitations";
import { recoverMemberMfa } from "@/lib/mfa-admin-recovery";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to access team members." }, { status: 401 });
  if (!(["Owner", "Admin"].includes(session.role))) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  return NextResponse.json({ team: await getTeamAdminSnapshot() }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session || !["Owner", "Admin"].includes(session.role)) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("adding team members") }, { status: 403 });
  const body = await request.json().catch(() => null) as { name?: string; email?: string; role?: "Admin" | "Supervisor" | "Agent" } | null;
  if (!body?.name || !body.email || !body.role) return NextResponse.json({ error: "Name, email, and role are required." }, { status: 400 });
  try {
    return NextResponse.json({ invitation: await createTeamInvitation({ name: body.name, email: body.email, role: body.role, invitedByUserId: session.userId }) }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not add team member." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing team access") }, { status: 403 });
  const body = await request.json().catch(() => null) as { id?: string; action?: "change_role" | "activate" | "deactivate" | "recover_mfa"; role?: "Admin" | "Supervisor" | "Agent"; reason?: string; identityVerified?: boolean } | null;
  if (!body?.id || !body.action || !["change_role", "activate", "deactivate", "recover_mfa"].includes(body.action)) return NextResponse.json({ error: "Team member and valid access change are required." }, { status: 400 });
  if (body.action === "recover_mfa") {
    if (body.identityVerified !== true) return NextResponse.json({ error: "Confirm that you verified this member’s identity through a separate trusted channel." }, { status: 400 });
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const member = await recoverMemberMfa({ actorUserId: session.userId, actorName: session.name, actorRole: session.role, targetUserId: body.id, reason: body.reason ?? "", sourceIp: request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "", userAgent: request.headers.get("user-agent") ?? "" });
      return NextResponse.json({ member, recoveryRequired: true, message: "MFA was reset and active sign-ins were revoked." });
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "Could not recover this account’s MFA." }, { status: 400 });
    }
  }
  try {
    const member = await updateTeamMember({ id: body.id, action: body.action, role: body.role, actorUserId: session.userId });
    return NextResponse.json({ member });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not change team access." }, { status: 400 }); }
}
