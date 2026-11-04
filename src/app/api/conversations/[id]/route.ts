import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateLocalConversation } from "@/lib/crm-store";
import { updateConversationForWorkspace, type ConversationAction } from "@/lib/conversation-management";
import { getScopedInboxSnapshot, canAccessConversation } from "@/lib/inbox-access";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to update conversations." }, { status: 401 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: ConversationAction; channelNumberId?: string; assigneeId?: string | null; assignee?: string | null; teamId?: string | null; tag?: string } | null;
  if (!body?.action || !["read", "resolve", "reopen", "wait", "assign", "assign_team", "add_tag", "remove_tag"].includes(body.action)) return NextResponse.json({ error: "Choose a supported conversation action." }, { status: 400 });
  const contactAction = body.action === "add_tag" || body.action === "remove_tag";
  if (!contactAction && process.env.DATABASE_URL && (typeof body.channelNumberId !== "string" || !body.channelNumberId.trim() || body.channelNumberId.length > 128)) return NextResponse.json({ error: "Choose the WhatsApp conversation thread to update." }, { status: 400 });
  try {
    if (!(await canAccessConversation(session, id, contactAction ? undefined : body.channelNumberId))) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
    if (session.role === "Agent" && body.action === "assign_team") return NextResponse.json({ error: "Only a supervisor or administrator can assign conversations to a team." }, { status: 403 });
    if (process.env.DATABASE_URL && session.role === "Supervisor" && body.action === "assign_team" && body.teamId) {
      const membership = await getPostgresPool().query(`SELECT 1 FROM "TeamMembership" WHERE "workspaceId"=$1 AND "teamId"=$2 AND "userId"=$3 LIMIT 1`, [getWorkspaceId(), body.teamId, session.userId]);
      if (!membership.rows.length) return NextResponse.json({ error: "Supervisors can assign conversations only to one of their teams." }, { status: 403 });
    }
    if (process.env.DATABASE_URL) {
      const snapshot = await getScopedInboxSnapshot(session, [id]);
      const chat = snapshot.chats.find((item) => item.id === id);
      if (!chat) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
      const memberById = body.action === "assign" && body.assigneeId ? snapshot.team.find((member) => member.id === body.assigneeId) : null;
      const memberByName = body.action === "assign" && body.assignee ? snapshot.team.find((member) => member.name === body.assignee) : null;
      if (body.action === "assign" && body.assigneeId && !memberById) return NextResponse.json({ error: "Choose an active team member in one of your permitted teams." }, { status: 403 });
      if (memberById && body.assignee && memberById.name !== body.assignee) return NextResponse.json({ error: "The selected assignee details do not match." }, { status: 400 });
      const teamMember = memberById ?? memberByName;
      if (body.action === "assign" && (body.assigneeId || body.assignee) && !teamMember) return NextResponse.json({ error: "Choose an active team member in one of your permitted teams." }, { status: 403 });
      const assigneeId = body.assigneeId ?? teamMember?.id ?? null;
      if (session.role === "Agent" && body.action === "assign" && assigneeId && assigneeId !== session.userId) return NextResponse.json({ error: "Agents can assign a conversation only to themselves." }, { status: 403 });
      await updateConversationForWorkspace({ contactId: id, channelNumberId: body.channelNumberId, action: body.action, assigneeId, teamId: body.teamId, tag: body.tag, actorUserId: session.userId, actorRole: session.role });
      const updated = (await getScopedInboxSnapshot(session, [id])).chats.find((item) => item.id === id);
      return NextResponse.json({ chat: updated });
    }
    if (body.action === "assign_team") return NextResponse.json({ error: "Team assignment requires PostgreSQL." }, { status: 503 });
    if (session.role === "Agent" && body.action === "assign" && body.assignee && body.assignee !== session.name) return NextResponse.json({ error: "Agents can assign a conversation only to themselves." }, { status: 403 });
    return NextResponse.json({ chat: await updateLocalConversation(id, body.action, body.assignee, body.tag) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update conversation." }, { status: 404 });
  }
}
