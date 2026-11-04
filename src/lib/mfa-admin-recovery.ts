import "server-only";

import { randomUUID } from "node:crypto";
import { createAdminAlert } from "@/lib/admin-alerts";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

async function notifyRecoveredMember(input: { email: string; actorName: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !baseUrl) return false;
  try {
    const base = new URL(baseUrl);
    const validProtocol = base.protocol === "https:" || (process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname));
    if (!validProtocol || base.username || base.password || base.search || base.hash || /[\r\n]/.test(from)) return false;
    const link = `${base.toString().replace(/\/$/, "")}/account/security`;
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `mfa-recovery-${randomUUID()}` },
      body: JSON.stringify({ from, to: [input.email], subject: "MFA was reset for your Relay CRM account", text: `An administrator (${input.actorName}) reset the authenticator security on your Relay CRM account after an identity check. Your active sign-ins were revoked and your previous authenticator and recovery codes no longer work. Sign in with your password and set up a new authenticator before making protected administrator changes: ${link}\n\nIf you did not expect this, contact your workspace owner immediately. Never share your password or authenticator codes by email.`, html: `<p>An administrator (<strong>${input.actorName.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!)}</strong>) reset the authenticator security on your Relay CRM account after an identity check. Your active sign-ins were revoked and your previous authenticator and recovery codes no longer work.</p><p><a href="${link}">Sign in and set up a new authenticator</a> before making protected administrator changes.</p><p>If you did not expect this, contact your workspace owner immediately. Never share your password or authenticator codes by email.</p>` }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch { return false; }
}

export async function recoverMemberMfa(input: { actorUserId: string; actorName: string; actorRole: string; targetUserId: string; reason: string; sourceIp?: string; userAgent?: string }) {
  if (!process.env.DATABASE_URL) throw new Error("Administrator-assisted MFA recovery requires PostgreSQL.");
  const reason = input.reason.trim();
  if (input.actorUserId === input.targetUserId) throw new Error("You cannot use administrator recovery for your own account.");
  if (reason.length < 20 || reason.length > 500) throw new Error("Record an identity-verification reason between 20 and 500 characters.");

  const workspaceId = getWorkspaceId();
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT wu."role",u."name",u."email",u."mfaEnabled" FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND wu."userId"=$2 AND u."active"=true FOR UPDATE OF wu,u`, [workspaceId, input.targetUserId]);
    const target = result.rows[0];
    if (!target) throw new Error("Active team member not found in this workspace.");
    const targetRole = String(target.role);
    if (targetRole === "OWNER" && input.actorRole !== "Owner") throw new Error("Only the workspace owner can recover an owner account.");
    if (targetRole === "ADMIN" && input.actorRole !== "Owner") throw new Error("Only the workspace owner can recover an administrator account.");
    if (!target.mfaEnabled) throw new Error("MFA is already disabled for this account.");

    await client.query(`UPDATE "User" SET "mfaEnabled"=false,"mfaSecret"=NULL,"mfaPendingSecret"=NULL,"mfaRecoveryCodeHashes"='{}',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [input.targetUserId]);
    const revoked = await client.query(`UPDATE "AuthSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "userId"=$2 AND "revokedAt" IS NULL RETURNING "id"`, [workspaceId, input.targetUserId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","userAgent","before","after","details","createdAt") VALUES ($1,$2,$3,'AUTH_MFA_RECOVERED_BY_ADMIN','USER',$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, input.targetUserId, input.sourceIp?.slice(0, 128) || null, input.userAgent?.slice(0, 512) || null, JSON.stringify({ mfaEnabled: true, role: targetRole }), JSON.stringify({ mfaEnabled: false, recoveryRequired: true }), JSON.stringify({ reason, identityVerifiedByAdministrator: true, revokedSessions: revoked.rows.length })]);
    await createAdminAlert(client, { workspaceId, dedupeKey: `mfa-admin-recovery:${input.targetUserId}:${Date.now()}`, severity: "WARNING", category: "ACCOUNT_SECURITY", title: "Administrator MFA recovery completed", message: `MFA was reset for ${String(target.name)} (${String(target.email)}) after administrator-recorded identity verification. The user must enroll a new authenticator before making protected administrator changes.`, targetType: "USER", targetId: input.targetUserId });
    await client.query("COMMIT");
    const noticeSent = await notifyRecoveredMember({ email: String(target.email), actorName: input.actorName });
    try {
      await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,$4,'USER',$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, noticeSent ? "AUTH_MFA_RECOVERY_NOTICE_SENT" : "AUTH_MFA_RECOVERY_NOTICE_NOT_SENT", input.targetUserId, JSON.stringify({ emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM && process.env.APP_BASE_URL), delivered: noticeSent })]);
    } catch {}
    return { id: input.targetUserId, name: String(target.name), email: String(target.email), revokedSessions: revoked.rows.length, noticeSent };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }
}
