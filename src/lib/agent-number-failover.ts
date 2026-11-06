import "server-only";

import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { updateChannelNumber, getCrmSnapshot, type ChannelNumber } from "@/lib/crm-store";
import { createAdminAlert } from "@/lib/admin-alerts";

type Row = QueryResultRow;

export type FailoverResult = {
  success: boolean;
  reallocated: boolean;
  agentId?: string;
  agentName?: string;
  fromNumberId: string;
  toNumberId?: string;
  replacementNumber?: { id: string; label: string; number: string; provider: string };
  reason?: string;
};

/**
 * Assign a WhatsApp channel number exclusively to a specific agent (user).
 * Exclusivity rule: 
 * 1. A number can only be assigned to 1 agent.
 * 2. An agent has 1 primary dedicated number (any prior number is returned to the unassigned pool).
 */
export async function assignNumberToAgent(params: {
  workspaceId: string;
  numberId: string;
  userId: string | null;
  actorUserId?: string;
}): Promise<{ success: boolean; number: Partial<ChannelNumber> }> {
  const { workspaceId, numberId, userId, actorUserId } = params;

  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Verify the number exists
      const numQuery = await client.query<Row>(
        `SELECT "id", "label", "e164Number", "assignedUserId", "state" FROM "ChannelNumber" WHERE "workspaceId" = $1 AND "id" = $2 FOR UPDATE`,
        [workspaceId, numberId],
      );
      if (!numQuery.rows[0]) throw new Error("WhatsApp number not found.");
      const currentNumber = numQuery.rows[0];

      if (userId) {
        // Verify user exists and is active in workspace
        const userQuery = await client.query<Row>(
          `SELECT u."id", u."name", u."email", wu."role" 
           FROM "User" u 
           JOIN "WorkspaceUser" wu ON wu."userId" = u."id" 
           WHERE wu."workspaceId" = $1 AND u."id" = $2 AND u."active" = true`,
          [workspaceId, userId],
        );
        if (!userQuery.rows[0]) throw new Error("Agent user not found or inactive.");
        const agentName = String(userQuery.rows[0].name);

        // Exclusivity: Clear this user from any other number in the workspace
        await client.query(
          `UPDATE "ChannelNumber" 
           SET "assignedUserId" = NULL, "updatedAt" = CURRENT_TIMESTAMP 
           WHERE "workspaceId" = $1 AND "assignedUserId" = $2 AND "id" <> $3`,
          [workspaceId, userId, numberId],
        );

        // Assign to this number
        await client.query(
          `UPDATE "ChannelNumber" 
           SET "assignedUserId" = $2, "updatedAt" = CURRENT_TIMESTAMP 
           WHERE "workspaceId" = $1 AND "id" = $3`,
          [workspaceId, userId, numberId],
        );

        // Audit Event
        await client.query(
          `INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
           VALUES ($1, $2, $3, 'CHANNEL_NUMBER_AGENT_ASSIGNED', 'CHANNEL_NUMBER', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [
            randomUUID(),
            workspaceId,
            actorUserId ?? userId,
            numberId,
            JSON.stringify({
              assignedUserId: userId,
              assignedUserName: agentName,
              numberLabel: currentNumber.label,
              e164Number: currentNumber.e164Number,
            }),
          ],
        );

        await client.query("COMMIT");
        return {
          success: true,
          number: {
            id: numberId,
            assignedUserId: userId,
            assignedUserName: agentName,
          },
        };
      } else {
        // Unassigning number back to pool
        await client.query(
          `UPDATE "ChannelNumber" 
           SET "assignedUserId" = NULL, "updatedAt" = CURRENT_TIMESTAMP 
           WHERE "workspaceId" = $1 AND "id" = $2`,
          [workspaceId, numberId],
        );

        await client.query(
          `INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
           VALUES ($1, $2, $3, 'CHANNEL_NUMBER_AGENT_UNASSIGNED', 'CHANNEL_NUMBER', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
          [
            randomUUID(),
            workspaceId,
            actorUserId ?? null,
            numberId,
            JSON.stringify({ previousAssignedUserId: currentNumber.assignedUserId }),
          ],
        );

        await client.query("COMMIT");
        return {
          success: true,
          number: {
            id: numberId,
            assignedUserId: null,
            assignedUserName: null,
          },
        };
      }
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  // Local JSON store fallback
  const updated = await updateChannelNumber(numberId, "assign_user", undefined, undefined, userId);
  return {
    success: true,
    number: {
      id: updated.id,
      assignedUserId: updated.assignedUserId,
      assignedUserName: updated.assignedUserName,
    },
  };
}

/**
 * Find the next available unassigned active number in the pool for an agent.
 * STRICT EXCLUSIVITY GUARANTEE:
 * 1. n."assignedUserId" IS NULL (Never select a number in use by another agent).
 * 2. n."state" = 'ACTIVE'
 * 3. Excludes any specified blocked/failed numbers.
 * 4. Honors team restrictions (allowedTeamIds).
 */
export async function findAvailableBackupNumber(params: {
  workspaceId: string;
  agentId?: string;
  teamId?: string | null;
  excludeNumberIds?: string[];
}): Promise<{ id: string; label: string; number: string; provider: string } | null> {
  const { workspaceId, teamId, excludeNumberIds = [] } = params;

  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const excludeArr = excludeNumberIds.length ? excludeNumberIds : null;

    const query = `
      SELECT n."id", n."label", n."e164Number", n."provider", n."routingPriority"
      FROM "ChannelNumber" n
      WHERE n."workspaceId" = $1
        AND n."state" = 'ACTIVE'
        AND n."assignedUserId" IS NULL
        AND ($2::text[] IS NULL OR NOT (n."id" = ANY($2::text[])))
        AND (
          $3::text IS NULL
          OR cardinality(n."allowedTeamIds") = 0
          OR $3 = ANY(n."allowedTeamIds")
        )
      ORDER BY n."routingPriority" ASC, n."createdAt" ASC
      LIMIT 1
    `;

    const res = await pool.query<Row>(query, [workspaceId, excludeArr, teamId ?? null]);
    if (!res.rows.length) return null;

    const row = res.rows[0];
    return {
      id: String(row.id),
      label: String(row.label),
      number: String(row.e164Number),
      provider: String(row.provider || "TWILIO"),
    };
  }

  // Local JSON store fallback
  const snapshot = await getCrmSnapshot();
  const excludeSet = new Set(excludeNumberIds);
  const candidates = snapshot.numbers.filter(
    (n) =>
      n.state === "Active" &&
      !n.assignedUserId &&
      !excludeSet.has(n.id) &&
      (!teamId || !n.allowedTeamIds?.length || n.allowedTeamIds.includes(teamId)),
  );

  if (!candidates.length) return null;
  const best = candidates[0];
  return {
    id: best.id,
    label: best.label,
    number: best.number,
    provider: best.provider || "TWILIO",
  };
}

/**
 * Auto-failover when an agent's assigned number is blocked or disconnected:
 * 1. Marks the failed number as DISCONNECTED / RESTRICTED.
 * 2. Checks if an agent was assigned to this number.
 * 3. If an agent was assigned, finds the next available UNASSIGNED number from the pool.
 * 4. Exclusively reassigns the new number to the agent.
 * 5. Creates a FailoverEvent and AdminAlert.
 */
export async function triggerAgentNumberFailover(params: {
  workspaceId: string;
  blockedNumberId: string;
  reason: string;
  actorUserId?: string;
}): Promise<FailoverResult> {
  const { workspaceId, blockedNumberId, reason, actorUserId } = params;

  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // 1. Fetch blocked number details
      const numQuery = await client.query<Row>(
        `SELECT n."id", n."label", n."e164Number", n."assignedUserId", n."provider",
                u."name" AS "agentName", tm."teamId"
         FROM "ChannelNumber" n
         LEFT JOIN "User" u ON u."id" = n."assignedUserId"
         LEFT JOIN "TeamMembership" tm ON tm."userId" = n."assignedUserId" AND tm."workspaceId" = n."workspaceId"
         WHERE n."workspaceId" = $1 AND n."id" = $2
         FOR UPDATE OF n`,
        [workspaceId, blockedNumberId],
      );

      if (!numQuery.rows.length) {
        await client.query("ROLLBACK");
        return { success: false, reallocated: false, fromNumberId: blockedNumberId, reason: "NUMBER_NOT_FOUND" };
      }

      const blockedNum = numQuery.rows[0];
      const assignedUserId = blockedNum.assignedUserId ? String(blockedNum.assignedUserId) : null;
      const agentName = blockedNum.agentName ? String(blockedNum.agentName) : "Team Agent";
      const teamId = blockedNum.teamId ? String(blockedNum.teamId) : null;

      // Mark blocked number as DISCONNECTED
      await client.query(
        `UPDATE "ChannelNumber"
         SET "state" = 'DISCONNECTED',
             "lastStatusEventAt" = CURRENT_TIMESTAMP,
             "updatedAt" = CURRENT_TIMESTAMP
         WHERE "workspaceId" = $1 AND "id" = $2`,
        [workspaceId, blockedNumberId],
      );

      // Audit status change
      await client.query(
        `INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
         VALUES ($1, $2, $3, 'CHANNEL_NUMBER_BLOCKED', 'CHANNEL_NUMBER', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
        [
          randomUUID(),
          workspaceId,
          actorUserId ?? null,
          blockedNumberId,
          JSON.stringify({ reason, previousState: "ACTIVE", newState: "DISCONNECTED" }),
        ],
      );

      // If no agent was assigned to this number, no agent reallocation needed
      if (!assignedUserId) {
        await createAdminAlert(client, {
          workspaceId,
          dedupeKey: `number-blocked:${blockedNumberId}`,
          severity: "WARNING",
          category: "NUMBER_HEALTH",
          title: `WhatsApp number ${blockedNum.label} disconnected`,
          message: `Unassigned pool number ${blockedNum.e164Number} was marked disconnected due to ${reason}.`,
          targetType: "CHANNEL_NUMBER",
          targetId: blockedNumberId,
        });
        await client.query("COMMIT");
        return {
          success: true,
          reallocated: false,
          fromNumberId: blockedNumberId,
          reason: "UNASSIGNED_NUMBER_MARKED_DISCONNECTED",
        };
      }

      // 2. Find next available UNASSIGNED number for this agent
      const candidateRes = await client.query<Row>(
        `SELECT n."id", n."label", n."e164Number", n."provider", n."routingPriority"
         FROM "ChannelNumber" n
         WHERE n."workspaceId" = $1
           AND n."state" = 'ACTIVE'
           AND n."assignedUserId" IS NULL
           AND n."id" <> $2
           AND (
             $3::text IS NULL
             OR cardinality(n."allowedTeamIds") = 0
             OR $3 = ANY(n."allowedTeamIds")
           )
         ORDER BY n."routingPriority" ASC, n."createdAt" ASC
         LIMIT 1
         FOR UPDATE`,
        [workspaceId, blockedNumberId, teamId],
      );

      if (!candidateRes.rows.length) {
        // No unassigned backup numbers in pool!
        await createAdminAlert(client, {
          workspaceId,
          dedupeKey: `failover-exhausted:${blockedNumberId}`,
          severity: "CRITICAL",
          category: "FAILOVER",
          title: `No backup number available for ${agentName}!`,
          message: `Agent ${agentName}'s number ${blockedNum.label} was blocked (${reason}), but NO unassigned numbers remain in the pool. Add new active WhatsApp numbers immediately.`,
          targetType: "USER",
          targetId: assignedUserId,
        });
        await client.query("COMMIT");

        return {
          success: false,
          reallocated: false,
          agentId: assignedUserId,
          agentName,
          fromNumberId: blockedNumberId,
          reason: "NO_UNASSIGNED_BACKUP_AVAILABLE",
        };
      }

      const replacement = candidateRes.rows[0];
      const replacementNumberId = String(replacement.id);

      // 3. Reassign agent to replacement number and detach from blocked number
      await client.query(
        `UPDATE "ChannelNumber" 
         SET "assignedUserId" = $2, "updatedAt" = CURRENT_TIMESTAMP 
         WHERE "workspaceId" = $1 AND "id" = $3`,
        [workspaceId, assignedUserId, replacementNumberId],
      );

      await client.query(
        `UPDATE "ChannelNumber" 
         SET "assignedUserId" = NULL, "updatedAt" = CURRENT_TIMESTAMP 
         WHERE "workspaceId" = $1 AND "id" = $2`,
        [workspaceId, blockedNumberId],
      );

      // 4. Record FailoverEvent
      const failoverId = randomUUID();
      await client.query(
        `INSERT INTO "FailoverEvent" (
          "id", "workspaceId", "scope", "reasonClass",
          "fromChannelNumberId", "toChannelNumberId", "outcome", "createdAt"
         )
         VALUES ($1, $2, 'PHONE_NUMBER', 'BLOCKED_SENDER_REASSIGNED', $3, $4, 'SENT', CURRENT_TIMESTAMP)`,
        [failoverId, workspaceId, blockedNumberId, replacementNumberId],
      );

      // 5. Create Audit Event & Admin Alert
      await client.query(
        `INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
         VALUES ($1, $2, $3, 'CHANNEL_FAILOVER_AGENT_REASSIGNED', 'CHANNEL_NUMBER', $4, $5::jsonb, CURRENT_TIMESTAMP)`,
        [
          randomUUID(),
          workspaceId,
          actorUserId ?? assignedUserId,
          replacementNumberId,
          JSON.stringify({
            failoverId,
            agentId: assignedUserId,
            agentName,
            fromNumberId: blockedNumberId,
            fromLabel: blockedNum.label,
            fromNumber: blockedNum.e164Number,
            toNumberId: replacementNumberId,
            toLabel: replacement.label,
            toNumber: replacement.e164Number,
            reason,
          }),
        ],
      );

      await createAdminAlert(client, {
        workspaceId,
        dedupeKey: `failover-reassigned:${failoverId}`,
        severity: "WARNING",
        category: "FAILOVER",
        title: `Auto-assigned new WhatsApp number to ${agentName}`,
        message: `Agent ${agentName}'s previous number (${blockedNum.label}) was blocked (${reason}). System automatically assigned new available number ${replacement.label} (${replacement.e164Number}). Conversation history is preserved.`,
        targetType: "FAILOVER_EVENT",
        targetId: failoverId,
      });

      await client.query("COMMIT");

      return {
        success: true,
        reallocated: true,
        agentId: assignedUserId,
        agentName,
        fromNumberId: blockedNumberId,
        toNumberId: replacementNumberId,
        replacementNumber: {
          id: replacementNumberId,
          label: String(replacement.label),
          number: String(replacement.e164Number),
          provider: String(replacement.provider || "TWILIO"),
        },
      };
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch {}
      throw err;
    } finally {
      client.release();
    }
  }

  // Local JSON store fallback
  const snapshot = await getCrmSnapshot();
  const blocked = snapshot.numbers.find((n) => n.id === blockedNumberId);
  if (!blocked) return { success: false, reallocated: false, fromNumberId: blockedNumberId, reason: "NUMBER_NOT_FOUND" };

  blocked.state = "Disconnected";
  const agentId = blocked.assignedUserId;
  const agentName = blocked.assignedUserName || "Team Agent";

  if (!agentId) {
    return { success: true, reallocated: false, fromNumberId: blockedNumberId, reason: "UNASSIGNED_NUMBER_MARKED_DISCONNECTED" };
  }

  const candidate = snapshot.numbers.find(
    (n) => n.state === "Active" && !n.assignedUserId && n.id !== blockedNumberId,
  );

  if (!candidate) {
    return {
      success: false,
      reallocated: false,
      agentId,
      agentName,
      fromNumberId: blockedNumberId,
      reason: "NO_UNASSIGNED_BACKUP_AVAILABLE",
    };
  }

  blocked.assignedUserId = null;
  blocked.assignedUserName = null;
  candidate.assignedUserId = agentId;
  candidate.assignedUserName = agentName;

  return {
    success: true,
    reallocated: true,
    agentId,
    agentName,
    fromNumberId: blockedNumberId,
    toNumberId: candidate.id,
    replacementNumber: {
      id: candidate.id,
      label: candidate.label,
      number: candidate.number,
      provider: candidate.provider || "TWILIO",
    },
  };
}
