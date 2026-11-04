import "server-only";

import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import { ensureWorkspace, getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

type InviteRole = "OWNER" | "ADMIN" | "SUPERVISOR" | "AGENT";
const validRoles = new Set<InviteRole>(["ADMIN", "SUPERVISOR", "AGENT"]);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function emailConfig() {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !baseUrl) throw new Error("Team invitations require configured workspace email settings.");
  const base = new URL(baseUrl);
  const validProtocol = base.protocol === "https:" || (process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname));
  if (!validProtocol || base.username || base.password || base.search || base.hash || /[\r\n]/.test(from)) throw new Error("Configure a safe HTTPS application URL and sender address for invitations.");
  return { apiKey, from, baseUrl: base.toString().replace(/\/$/, "") };
}

async function sendInviteEmail(email: string, name: string, role: string, token: string) {
  const { apiKey, from, baseUrl } = emailConfig();
  const inviteUrl = `${baseUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
  const roleName = role === "OWNER" ? "Workspace owner" : role[0] + role.slice(1).toLowerCase();
  const safeName = name.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "You are invited to Relay CRM",
      text: `Hello ${name},\n\n${role === "OWNER" ? "Verify this email address to finish setting up your Relay CRM workspace owner account." : `You have been invited to join Relay CRM as ${roleName}.`} Set your password using this one-time link. It expires in 48 hours.\n\n${inviteUrl}\n\nIf you were not expecting this, you can ignore this email.`,
      html: `<p>Hello ${safeName},</p><p>${role === "OWNER" ? "Verify this email address to finish setting up your Relay CRM workspace owner account." : `You have been invited to join Relay CRM as ${roleName}.`} Set your password using this one-time link. It expires in 48 hours.</p><p><a href="${inviteUrl}">Verify and continue</a></p><p>If you were not expecting this, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Invitation email delivery failed. Check the workspace email settings and try again.");
}

export async function createTeamInvitation(input: { name: string; email: string; role: string; invitedByUserId: string }) {
  return createInvitation({ ...input, bootstrapOwner: false });
}

export async function createOwnerSetupInvitation(input: { name: string; email: string }) {
  return createInvitation({ ...input, role: "OWNER", invitedByUserId: null, bootstrapOwner: true });
}

async function createInvitation(input: { name: string; email: string; role: string; invitedByUserId: string | null; bootstrapOwner: boolean }) {
  if (!process.env.DATABASE_URL) throw new Error("Team invitations require PostgreSQL.");
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role.toUpperCase() as InviteRole;
  if (!name || name.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new Error("Enter a valid name and email address.");
  if (input.bootstrapOwner ? role !== "OWNER" || input.invitedByUserId !== null : !validRoles.has(role as Exclude<InviteRole, "OWNER">) || !input.invitedByUserId) throw new Error("Choose a valid workspace role.");
  emailConfig();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest(token);
  const id = randomUUID();
  const workspaceId = getWorkspaceId();
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", [workspaceId, email]);
    await ensureWorkspace(client);
    if (input.bootstrapOwner) {
      await client.query(`SELECT "id" FROM "Workspace" WHERE "id"=$1 FOR UPDATE`, [workspaceId]);
      const owner = await client.query(`SELECT 1 FROM "WorkspaceUser" WHERE "workspaceId"=$1 AND "role"='OWNER'::"WorkspaceRole" LIMIT 1`, [workspaceId]);
      if (owner.rows.length) throw new Error("Owner setup is already complete.");
      const pendingOwner = await client.query(`SELECT lower("email") AS "email" FROM "WorkspaceInvitation" WHERE "workspaceId"=$1 AND "role"='OWNER'::"WorkspaceRole" AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP LIMIT 1 FOR UPDATE`, [workspaceId]);
      if (pendingOwner.rows[0] && String(pendingOwner.rows[0].email) !== email) throw new Error("Owner verification was already requested. Check the invited mailbox or contact your system administrator.");
    }
    const exists = await client.query(`SELECT 1 FROM "User" WHERE lower("email")=$1`, [email]);
    if (exists.rows.length) throw new Error("An account already uses that email address.");
    await client.query(`UPDATE "WorkspaceInvitation" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND lower("email")=$2 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL`, [workspaceId, email]);
    await client.query(`INSERT INTO "WorkspaceInvitation" ("id","workspaceId","invitedByUserId","email","name","role","tokenHash","createdAt","expiresAt") VALUES ($1,$2,$3,$4,$5,$6::"WorkspaceRole",$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP+INTERVAL '48 hours')`, [id, workspaceId, input.invitedByUserId, email, name, role, tokenHash]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,$4,'WORKSPACE_INVITATION',$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.invitedByUserId, input.bootstrapOwner ? "OWNER_SETUP_VERIFICATION_REQUESTED" : "TEAM_INVITATION_CREATED", id, JSON.stringify({ email, name, role, expiresInHours: 48 })]);
    await client.query("COMMIT");
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally { client.release(); }

  try {
    await sendInviteEmail(email, name, role, token);
  } catch (error) {
    await getPostgresPool().query(`UPDATE "WorkspaceInvitation" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "acceptedAt" IS NULL`, [id]);
    try { await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,$4,'WORKSPACE_INVITATION',$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.invitedByUserId, input.bootstrapOwner ? "OWNER_SETUP_EMAIL_FAILED" : "TEAM_INVITATION_DELIVERY_FAILED", id, JSON.stringify({ reason: error instanceof Error ? error.message.slice(0, 200) : "Delivery failure" })]); } catch {}
    throw error;
  }
  return { id, email, name, role: role === "OWNER" ? "Owner" : role === "ADMIN" ? "Admin" : role === "SUPERVISOR" ? "Supervisor" : "Agent", expiresInHours: 48 };
}

export async function acceptTeamInvitation(token: string, password: string) {
  if (!process.env.DATABASE_URL) throw new Error("Team invitations require PostgreSQL.");
  if (!token || token.length > 128 || password.length < 12 || password.length > 1024) throw new Error("Use the invitation link and choose a password with at least 12 characters.");
  const tokenHash = digest(token);
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT "id","workspaceId","invitedByUserId","email","name","role" FROM "WorkspaceInvitation" WHERE "tokenHash"=$1 AND "acceptedAt" IS NULL AND "revokedAt" IS NULL AND "expiresAt">CURRENT_TIMESTAMP FOR UPDATE`, [tokenHash]);
    const invitation = result.rows[0];
    if (!invitation) { await client.query("ROLLBACK"); return null; }
    const isOwnerSetup = String(invitation.role) === "OWNER" && invitation.invitedByUserId == null;
    if (String(invitation.role) === "OWNER" && !isOwnerSetup) throw new Error("This owner invitation is invalid. Ask an administrator for help.");
    if (isOwnerSetup) {
      await client.query(`SELECT "id" FROM "Workspace" WHERE "id"=$1 FOR UPDATE`, [String(invitation.workspaceId)]);
      const owner = await client.query(`SELECT 1 FROM "WorkspaceUser" WHERE "workspaceId"=$1 AND "role"='OWNER'::"WorkspaceRole" LIMIT 1`, [String(invitation.workspaceId)]);
      if (owner.rows.length) throw new Error("Owner setup has already been completed. Sign in or ask your administrator for help.");
    } else if (!invitation.invitedByUserId) throw new Error("This invitation is invalid. Ask your administrator for a new one.");
    const exists = await client.query(`SELECT 1 FROM "User" WHERE lower("email")=lower($1)`, [String(invitation.email)]);
    if (exists.rows.length) throw new Error("An account already uses this email address. Ask an administrator for help.");
    const userId = randomUUID();
    await client.query(`INSERT INTO "User" ("id","email","name","passwordHash","active","createdAt","updatedAt") VALUES ($1,$2,$3,$4,true,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [userId, String(invitation.email), String(invitation.name), passwordHash]);
    await client.query(`INSERT INTO "WorkspaceUser" ("workspaceId","userId","role","joinedAt") VALUES ($1,$2,$3::"WorkspaceRole",CURRENT_TIMESTAMP)`, [String(invitation.workspaceId), userId, String(invitation.role)]);
    await client.query(`UPDATE "WorkspaceInvitation" SET "acceptedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [String(invitation.id)]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,$4,'USER',$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), String(invitation.workspaceId), invitation.invitedByUserId == null ? null : String(invitation.invitedByUserId), isOwnerSetup ? "OWNER_SETUP_COMPLETED" : "TEAM_INVITATION_ACCEPTED", userId, JSON.stringify({ email: invitation.email, role: invitation.role })]);
    await client.query("COMMIT");
    return { email: String(invitation.email), name: String(invitation.name), role: String(invitation.role) };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof Error && error.message.includes("unique constraint")) throw new Error("An account already uses this email address. Ask an administrator for help.");
    throw error;
  } finally { client.release(); }
}
