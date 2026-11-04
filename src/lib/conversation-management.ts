import "server-only";

import { randomUUID } from "node:crypto";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export type ConversationAction = "read" | "resolve" | "reopen" | "wait" | "assign" | "assign_team" | "add_tag" | "remove_tag";

export async function updateConversationForWorkspace(input: {
  contactId: string;
  channelNumberId?: string;
  action: ConversationAction;
  assigneeId?: string | null;
  teamId?: string | null;
  tag?: string;
  actorUserId: string;
  actorRole: string;
}) {
  const pool = getPostgresPool();
  const client = await pool.connect();
  const workspaceId = getWorkspaceId();
  try {
    await client.query("BEGIN");
    const contactResult = await client.query(`SELECT "id","tags" FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2 FOR UPDATE`, [input.contactId, workspaceId]);
    const contact = contactResult.rows[0];
    if (!contact) throw new Error("Conversation not found.");
    const currentTags = Array.isArray(contact.tags) ? contact.tags.map(String) : [];
    let assignee: { id: string; name: string } | null = null;
    if (input.action === "assign" && input.assigneeId) {
      const member = await client.query(`SELECT u."id",u."name" FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND u."id"=$2 AND u."active"=TRUE`, [workspaceId, input.assigneeId]);
      if (!member.rows[0]) throw new Error("Choose an active team member in this workspace.");
      assignee = { id: String(member.rows[0].id), name: String(member.rows[0].name) };
    }
    let team: { id: string; name: string } | null = null;
    if (input.action === "assign_team" && input.teamId) {
      const result = await client.query(`SELECT "id","name" FROM "Team" WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, input.teamId]);
      if (!result.rows[0]) throw new Error("Choose a team in this workspace.");
      team = { id: String(result.rows[0].id), name: String(result.rows[0].name) };
    }
    let nextTags = currentTags;
    if (input.action === "add_tag" || input.action === "remove_tag") {
      const tag = input.tag?.trim();
      if (!tag || tag.length > 32) throw new Error("Tag must be between 1 and 32 characters.");
      nextTags = input.action === "add_tag" ? [...new Set([...currentTags, tag])] : currentTags.filter((current) => current !== tag);
      await client.query(`UPDATE "Contact" SET "tags"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "workspaceId"=$2`, [input.contactId, workspaceId, nextTags]);
    }
    let before: Record<string, unknown> = {};
    let after: Record<string, unknown> = {};
    if (input.action === "read" || input.action === "resolve" || input.action === "reopen" || input.action === "wait" || input.action === "assign" || input.action === "assign_team") {
      const conversations = await client.query(`SELECT c."id",c."channelNumberId",c."state",c."assignedUserId",c."assignedTeamId",c."unreadCount" FROM "Conversation" c
        WHERE c."contactId"=$1 AND c."workspaceId"=$2 AND ($5::text IS NULL OR c."channelNumberId"=$5) AND (
          $3 IN ('Owner','Admin') OR c."assignedUserId"=$4 OR (c."assignedUserId" IS NULL AND c."assignedTeamId" IS NULL)
          OR ($3='Supervisor' AND c."assignedTeamId" IN (SELECT tm."teamId" FROM "TeamMembership" tm WHERE tm."workspaceId"=$2 AND tm."userId"=$4)
        )) FOR UPDATE OF c`, [input.contactId, workspaceId, input.actorRole, input.actorUserId, input.channelNumberId ?? null]);
      if (!conversations.rows.length) throw new Error("Conversation not found.");
      if (input.action === "assign" && assignee) {
        const currentTeamIds = [...new Set(conversations.rows.map((row) => row.assignedTeamId).filter((id): id is string => Boolean(id)))];
        for (const teamId of currentTeamIds) {
          const membership = await client.query(`SELECT 1 FROM "TeamMembership" tm JOIN "WorkspaceUser" wu ON wu."workspaceId"=tm."workspaceId" AND wu."userId"=tm."userId" JOIN "User" u ON u."id"=tm."userId" WHERE tm."workspaceId"=$1 AND tm."teamId"=$2 AND tm."userId"=$3 AND u."active"=TRUE`, [workspaceId, teamId, assignee.id]);
          if (!membership.rows[0]) throw new Error("The assignee must be an active member of every affected conversation team.");
        }
      }
      if (input.action === "assign_team" && team) {
        const currentAssigneeIds = [...new Set(conversations.rows.map((row) => row.assignedUserId).filter((id): id is string => Boolean(id)))];
        for (const currentAssigneeId of currentAssigneeIds) {
          const membership = await client.query(`SELECT 1 FROM "TeamMembership" tm JOIN "WorkspaceUser" wu ON wu."workspaceId"=tm."workspaceId" AND wu."userId"=tm."userId" JOIN "User" u ON u."id"=tm."userId" WHERE tm."workspaceId"=$1 AND tm."teamId"=$2 AND tm."userId"=$3 AND u."active"=TRUE`, [workspaceId, team.id, currentAssigneeId]);
          if (!membership.rows[0]) throw new Error("Clear or reassign the current agent before moving this conversation to a team they do not belong to.");
        }
      }
      before = { conversations: conversations.rows.map((row) => ({ id: row.id, channelNumberId: row.channelNumberId, state: row.state, assignedUserId: row.assignedUserId, assignedTeamId: row.assignedTeamId, unreadCount: row.unreadCount })) };
      const setClauses: string[] = [];
      const values: unknown[] = [];
      if (input.action === "read") setClauses.push('"unreadCount"=0');
      if (input.action === "resolve" || input.action === "reopen" || input.action === "wait") {
        values.push(input.action === "resolve" ? "RESOLVED" : input.action === "wait" ? "WAITING" : "OPEN");
        setClauses.push(`"state"=$${values.length}::"ConversationState"`);
      }
      if (input.action === "assign") {
        values.push(assignee?.id ?? null);
        setClauses.push(`"assignedUserId"=$${values.length}`);
      }
      if (input.action === "assign_team") {
        values.push(team?.id ?? null);
        setClauses.push(`"assignedTeamId"=$${values.length}`);
      }
      if (setClauses.length && conversations.rows.length) {
        values.push(conversations.rows.map((row) => String(row.id)), workspaceId);
        await client.query(`UPDATE "Conversation" SET ${setClauses.join(",")},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=ANY($${values.length - 1}::text[]) AND "workspaceId"=$${values.length}`, values);
      }
      after = { action: input.action, channelNumberId: input.channelNumberId, state: input.action === "resolve" ? "RESOLVED" : input.action === "wait" ? "WAITING" : input.action === "reopen" ? "OPEN" : undefined, assignedUserId: input.action === "assign" ? assignee?.id ?? null : undefined, assignedTo: input.action === "assign" ? assignee?.name ?? null : undefined, assignedTeamId: input.action === "assign_team" ? team?.id ?? null : undefined, assignedTeam: input.action === "assign_team" ? team?.name ?? null : undefined, unreadCount: input.action === "read" ? 0 : undefined };
    }
    if (input.action === "add_tag" || input.action === "remove_tag") {
      before = { tags: currentTags };
      after = { tags: nextTags };
    }
    const actionNames: Record<ConversationAction, string> = { read: "CONVERSATION_MARKED_READ", resolve: "CONVERSATION_RESOLVED", reopen: "CONVERSATION_REOPENED", wait: "CONVERSATION_MARKED_WAITING", assign: "CONVERSATION_ASSIGNED", assign_team: "CONVERSATION_TEAM_ASSIGNED", add_tag: "CONTACT_TAG_ADDED", remove_tag: "CONTACT_TAG_REMOVED" };
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,$4,'CONTACT',$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, actionNames[input.action], input.contactId, JSON.stringify(before), JSON.stringify(after)]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
