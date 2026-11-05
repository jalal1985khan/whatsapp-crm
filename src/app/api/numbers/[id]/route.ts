import { NextRequest, NextResponse } from "next/server";
import { moveChannelNumber, updateChannelNumber } from "@/lib/crm-store";
import { mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { checkMetaNumberIdentity, type MetaNumberCheck } from "@/lib/meta-number-health";
import { randomUUID } from "node:crypto";

export const runtime = "nodejs";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing number approval, activity, or routing priority") }, { status: 403 });
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: "approve" | "pause" | "activate" | "archive" | "rename" | "move_up" | "move_down" | "set_allowed_teams"; label?: string; allowedTeamIds?: unknown } | null;
  if (!body?.action || !["approve", "pause", "activate", "archive", "rename", "move_up", "move_down", "set_allowed_teams"].includes(body.action)) return NextResponse.json({ error: "Choose a valid number-management action." }, { status: 400 });
  let allowedTeamIds: string[] = [];
  if (body.action === "set_allowed_teams") {
    if (!Array.isArray(body.allowedTeamIds) || body.allowedTeamIds.length > 200 || body.allowedTeamIds.some((teamId) => typeof teamId !== "string" || teamId.length > 128)) return NextResponse.json({ error: "Choose valid workspace teams." }, { status: 400 });
    allowedTeamIds = [...new Set(body.allowedTeamIds as string[])];
    if (allowedTeamIds.length && !process.env.DATABASE_URL) return NextResponse.json({ error: "Team-restricted sender numbers require PostgreSQL and workspace teams." }, { status: 503 });
  }
  try {
    const snapshotBefore = await import("@/lib/crm-store").then(({ getCrmSnapshot }) => getCrmSnapshot());
    const beforeNumber = snapshotBefore.numbers.find((item) => item.id === id);
    if (!beforeNumber) return NextResponse.json({ error: "Number not found." }, { status: 404 });
    const isMetaNumber = beforeNumber.provider === "META" || Boolean(beforeNumber.metaPhoneNumberId && beforeNumber.metaWabaId);
    const needsMetaRevalidation = Boolean(isMetaNumber && process.env.DATABASE_URL && (body.action === "approve" || body.action === "activate"));
    let activationCheck: MetaNumberCheck | null = null;
    if (needsMetaRevalidation) {
      activationCheck = await checkMetaNumberIdentity({ id, e164Number: beforeNumber.number, metaPhoneNumberId: beforeNumber.metaPhoneNumberId ?? null, metaWabaId: beforeNumber.metaWabaId ?? null });
      await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'CHANNEL_NUMBER_ACTIVATION_CHECKED','CHANNEL_NUMBER',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, id, JSON.stringify({ outcome: activationCheck.outcome, httpStatus: activationCheck.httpStatus, providerCode: activationCheck.providerCode, durationMs: activationCheck.durationMs, qualityRating: activationCheck.qualityRating, numberMatches: activationCheck.numberMatches, verifiedName: activationCheck.verifiedName, error: activationCheck.error })]);
      if (activationCheck.outcome !== "PASSED") return NextResponse.json({ error: `Meta asset check failed. This number was not activated. ${activationCheck.error ?? "Review the Meta connection and try again."}`, metaCheck: activationCheck }, { status: 409 });
    }
    if (body.action === "set_allowed_teams" && allowedTeamIds.length) {
      const teams = await getPostgresPool().query(`SELECT "id" FROM "Team" WHERE "workspaceId"=$1 AND "id"=ANY($2::text[])`, [getWorkspaceId(), allowedTeamIds]);
      if (teams.rows.length !== allowedTeamIds.length) return NextResponse.json({ error: "Select only teams that belong to this workspace." }, { status: 400 });
    }
    if (process.env.DATABASE_URL && ["approve", "activate", "pause", "archive"].includes(body.action)) {
      const client = await getPostgresPool().connect();
      const workspaceId = getWorkspaceId();
      try {
        await client.query("BEGIN");
        const current = await client.query(`SELECT "state","metaPhoneNumberId","metaWabaId","approvedByUserId" FROM "ChannelNumber" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE`, [workspaceId, id]);
        const row = current.rows[0];
        if (!row) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Number not found." }, { status: 404 }); }
        if (needsMetaRevalidation && (String(row.metaPhoneNumberId ?? "") !== String(beforeNumber.metaPhoneNumberId ?? "") || String(row.metaWabaId ?? "") !== String(beforeNumber.metaWabaId ?? ""))) { await client.query("ROLLBACK"); return NextResponse.json({ error: "The Meta number mapping changed during the check. Refresh the page and run the action again." }, { status: 409 }); }
        const state = String(row.state);
        const invalidTransition =
          (body.action === "approve" && state !== "PENDING") ||
          (body.action === "activate" && state !== "PAUSED" && state !== "DISCONNECTED") ||
          (body.action === "pause" && state !== "ACTIVE" && state !== "DEGRADED") ||
          (body.action === "archive" && state === "ARCHIVED");
        if (invalidTransition) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: body.action === "approve" ? "Only a pending number can be approved." : body.action === "activate" ? "Only a paused or disconnected number can be reactivated." : body.action === "pause" ? "Only an active or degraded number can be paused." : "This number is already archived." }, { status: 409 });
        }
        if ((body.action === "approve" || body.action === "activate") && isMetaNumber && (!row.metaPhoneNumberId || !row.metaWabaId)) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Reconnect this number to its Meta phone number ID and WABA before activating it." }, { status: 409 }); }
        if (body.action === "activate" && !row.approvedByUserId) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This number has not been approved in the CRM workspace yet." }, { status: 409 }); }
        const nextState = body.action === "pause" ? "PAUSED" : body.action === "archive" ? "ARCHIVED" : "ACTIVE";
        const updated = body.action === "approve"
          ? await client.query(`UPDATE "ChannelNumber" SET "state"='ACTIVE',"approvedByUserId"=$3,"approvedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [workspaceId, id, session.userId])
          : await client.query(`UPDATE "ChannelNumber" SET "state"=$3::"NumberState","updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2 RETURNING "id"`, [workspaceId, id, nextState]);
        if (!updated.rows.length) { await client.query("ROLLBACK"); return NextResponse.json({ error: "This number could not be activated." }, { status: 409 }); }
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,$4,'CHANNEL_NUMBER',$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, `CHANNEL_NUMBER_${body.action.toUpperCase()}`, id, JSON.stringify({ state, approvedByUserId: row.approvedByUserId ?? null }), JSON.stringify({ state: nextState, approvedByUserId: body.action === "approve" ? session.userId : row.approvedByUserId, approvedAt: body.action === "approve" ? new Date().toISOString() : null })]);
        await client.query("COMMIT");
      } catch (error) {
        try { await client.query("ROLLBACK"); } catch {}
        throw error;
      } finally { client.release(); }
      const snapshot = await import("@/lib/crm-store").then(({ getCrmSnapshot }) => getCrmSnapshot());
      return NextResponse.json({ number: snapshot.numbers.find((item) => item.id === id), numbers: snapshot.numbers, metaCheck: activationCheck });
    }
    const number = body.action === "move_up" ? await moveChannelNumber(id, "up") : body.action === "move_down" ? await moveChannelNumber(id, "down") : await updateChannelNumber(id, body.action, body.label, allowedTeamIds);
    if (process.env.DATABASE_URL && ["approve", "pause", "activate", "archive", "rename", "move_up", "move_down", "set_allowed_teams"].includes(body.action)) {
      const workspaceId = getWorkspaceId();
      const before = body.action === "rename" ? { label: beforeNumber.label } : body.action === "move_up" || body.action === "move_down" ? { routingPriority: beforeNumber.routingPriority } : body.action === "set_allowed_teams" ? { allowedTeamIds: beforeNumber.allowedTeamIds ?? [] } : { state: beforeNumber.state };
      const details = body.action === "rename" ? { label: number.label } : body.action === "move_up" || body.action === "move_down" ? { routingPriority: number.routingPriority } : body.action === "set_allowed_teams" ? { allowedTeamIds: number.allowedTeamIds ?? [] } : { state: number.state };
      await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt")
        VALUES ($1,$2,$3,$4,'CHANNEL_NUMBER',$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, `CHANNEL_NUMBER_${body.action.toUpperCase()}`, id, JSON.stringify(before), JSON.stringify(details)]);
    }
    const snapshot = await import("@/lib/crm-store").then(({ getCrmSnapshot }) => getCrmSnapshot());
    return NextResponse.json({ number, numbers: snapshot.numbers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update number." }, { status: 400 });
  }
}
