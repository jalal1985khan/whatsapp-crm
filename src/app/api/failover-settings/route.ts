import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange, requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;

export async function GET() {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ enabled: false, configurable: false });
  try {
    const pool = getPostgresPool();
    const result = await pool.query<Row>(`SELECT "autoFailoverEnabled", "failoverNotificationTemplateId", "failoverMaxAttempts", "failoverCooldownMinutes", "failoverRequiresApproval" FROM "Workspace" WHERE "id" = $1`, [getWorkspaceId()]);
    return NextResponse.json({ enabled: Boolean(result.rows[0]?.autoFailoverEnabled), notificationTemplateId: result.rows[0]?.failoverNotificationTemplateId ?? null, maxAttempts: Number(result.rows[0]?.failoverMaxAttempts ?? 1), cooldownMinutes: Number(result.rows[0]?.failoverCooldownMinutes ?? 60), requiresApproval: Boolean(result.rows[0]?.failoverRequiresApproval), configurable: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read failover settings." }, { status: 503 });
  }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing failover settings") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Failover settings require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { enabled?: boolean; notificationTemplateId?: string | null; maxAttempts?: number; cooldownMinutes?: number; requiresApproval?: boolean } | null;
  if (typeof body?.enabled !== "boolean") return NextResponse.json({ error: "Choose whether guarded failover is enabled." }, { status: 400 });
  if (body.maxAttempts !== undefined && (!Number.isInteger(body.maxAttempts) || body.maxAttempts < 0 || body.maxAttempts > 1)) return NextResponse.json({ error: "The current safe retry limit is zero or one backup attempt." }, { status: 400 });
  if (body.cooldownMinutes !== undefined && (!Number.isInteger(body.cooldownMinutes) || ![0, 5, 15, 30, 60, 120].includes(body.cooldownMinutes))) return NextResponse.json({ error: "Choose a supported cooldown: off, 5, 15, 30, 60, or 120 minutes." }, { status: 400 });
  if (body.requiresApproval !== undefined && typeof body.requiresApproval !== "boolean") return NextResponse.json({ error: "Choose whether a workspace administrator must approve backup sending." }, { status: 400 });
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const previous = await client.query<Row>(`SELECT "autoFailoverEnabled", "failoverNotificationTemplateId", "failoverMaxAttempts", "failoverCooldownMinutes", "failoverRequiresApproval" FROM "Workspace" WHERE "id" = $1 FOR UPDATE`, [workspaceId]);
    if (!previous.rows.length) throw new Error("Workspace not found.");
    const maxAttempts = body.maxAttempts ?? Number(previous.rows[0].failoverMaxAttempts ?? 1);
    const cooldownMinutes = body.cooldownMinutes ?? Number(previous.rows[0].failoverCooldownMinutes ?? 60);
    const requiresApproval = body.requiresApproval ?? Boolean(previous.rows[0].failoverRequiresApproval);
    if (requiresApproval && maxAttempts === 0) throw new Error("Require at least one allowed backup attempt when administrator approval is enabled.");
    let notificationTemplateId = previous.rows[0].failoverNotificationTemplateId == null ? null : String(previous.rows[0].failoverNotificationTemplateId);
    if (Object.hasOwn(body, "notificationTemplateId")) {
      if (body.notificationTemplateId == null) notificationTemplateId = null;
      else if (body.enabled || body.notificationTemplateId !== notificationTemplateId) {
        const selected = await client.query<Row>(`SELECT "status", "category", "components", "syncedAt" FROM "WhatsAppTemplate" WHERE "id" = $1 AND "workspaceId" = $2`, [body.notificationTemplateId, workspaceId]);
        const template = selected.rows[0];
        const components = Array.isArray(template?.components) ? template.components as { type?: string; text?: string }[] : [];
        const bodyComponent = components.find((component) => component.type?.toUpperCase() === "BODY");
        const text = bodyComponent?.text ?? "";
        const variables = [...new Set([...text.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]))];
        const extraVariables = components.some((component) => component !== bodyComponent && typeof component.text === "string" && /\{\{[^}]+\}\}/.test(component.text));
        const singleSupportedVariable = variables.length === 1 && (variables[0] === "1" || /^[a-z][a-z0-9_]*$/.test(variables[0]));
        if (!template || String(template.status).toUpperCase() !== "APPROVED" || String(template.category).toUpperCase() !== "UTILITY" || new Date(String(template.syncedAt)).getTime() < Date.now() - 24 * 60 * 60 * 1000 || !singleSupportedVariable || extraVariables) {
          throw new Error("Choose a recently synced approved Utility template with one numbered or lowercase named variable in its body and no variables elsewhere.");
        }
        notificationTemplateId = body.notificationTemplateId;
      } else notificationTemplateId = body.notificationTemplateId;
    }
    await client.query(`UPDATE "Workspace" SET "autoFailoverEnabled" = $2, "failoverNotificationTemplateId" = $3, "failoverMaxAttempts" = $4, "failoverRequiresApproval" = $5, "failoverCooldownMinutes" = $6, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [workspaceId, body.enabled, notificationTemplateId, maxAttempts, requiresApproval, cooldownMinutes]);
    const actor = await client.query<Row>(`SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`, [session.email]);
    if (!body.enabled || maxAttempts === 0) {
      const canceled = await client.query<Row>(`UPDATE "FailoverEvent" SET "approvalRequired"=false,"outcome"='SUPPRESSED' WHERE "workspaceId"=$1 AND "approvalRequired"=true AND "outcome"='NEEDS_REVIEW' RETURNING "id"`, [workspaceId]);
      if (canceled.rows.length) await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'FAILOVER_PENDING_APPROVALS_CANCELED','WORKSPACE',$2,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, actor.rows[0]?.id ?? null, JSON.stringify({ count: canceled.rows.length, reason: body.enabled ? "RETRY_LIMIT_ZERO" : "FAILOVER_DISABLED" })]);
    }
    await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "before", "after", "createdAt")
      VALUES ($1,$2,$3,'WORKSPACE_FAILOVER_SETTING_CHANGED','WORKSPACE',$2,$4::jsonb,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, actor.rows[0]?.id ?? null, JSON.stringify({ enabled: Boolean(previous.rows[0].autoFailoverEnabled), notificationTemplateId: previous.rows[0].failoverNotificationTemplateId ?? null, maxAttempts: Number(previous.rows[0].failoverMaxAttempts ?? 1), cooldownMinutes: Number(previous.rows[0].failoverCooldownMinutes ?? 60), requiresApproval: Boolean(previous.rows[0].failoverRequiresApproval) }), JSON.stringify({ enabled: body.enabled, notificationTemplateId, maxAttempts, cooldownMinutes, requiresApproval })]);
    await client.query("COMMIT");
    return NextResponse.json({ enabled: body.enabled, notificationTemplateId, maxAttempts, cooldownMinutes, requiresApproval, configurable: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update failover settings." }, { status: 503 });
  } finally { client.release(); }
}
