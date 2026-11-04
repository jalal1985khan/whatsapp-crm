import "server-only";

import { createHash, randomBytes, randomUUID, scryptSync } from "node:crypto";
import type { QueryResultRow } from "pg";
import { changeAccountPassword, getAuthUser } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { revokeAuthSessions } from "@/lib/auth";

type Row = QueryResultRow;
type LocalReset = { userId: string | null; email: string; expiresAt: number; usedAt: number | null };
const localResetTokens = new Map<string, LocalReset>();
const localResetInFlight = new Set<string>();
const localResetLimits = new Map<string, { failures: number; windowStartedAt: number; blockedUntil: number }>();
const RESET_WINDOW_MS = 15 * 60 * 1000;
const RESET_MAX_REQUESTS = 5;

function digest(value: string) { return createHash("sha256").update(value).digest("hex"); }

async function allowResetRequest(email: string, ip: string) {
  const keys = [digest(`reset-email:${email.trim().toLowerCase()}`), digest(`reset-ip:${ip || "unknown"}`)];
  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const existing = await pool.query<{ keyHash: string; blockedUntil: Date | string | null }>(`SELECT "keyHash", "blockedUntil" FROM "LoginRateLimit" WHERE "keyHash" = ANY($1::text[])`, [keys]);
    if (existing.rows.some((row) => row.blockedUntil && new Date(row.blockedUntil).getTime() > Date.now())) return false;
    for (const key of keys) await pool.query(`INSERT INTO "LoginRateLimit" ("keyHash", "failureCount", "windowStartedAt", "blockedUntil", "updatedAt")
      VALUES ($1,1,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP) ON CONFLICT ("keyHash") DO UPDATE SET
      "failureCount" = CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE "LoginRateLimit"."failureCount" + 1 END,
      "windowStartedAt" = CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN CURRENT_TIMESTAMP ELSE "LoginRateLimit"."windowStartedAt" END,
      "blockedUntil" = CASE WHEN (CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE "LoginRateLimit"."failureCount" + 1 END) >= $2 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END,
      "updatedAt" = CURRENT_TIMESTAMP`, [key, RESET_MAX_REQUESTS]);
    await pool.query(`DELETE FROM "PasswordResetToken" WHERE "workspaceId" = $1 AND ("expiresAt" < CURRENT_TIMESTAMP OR "createdAt" < CURRENT_TIMESTAMP - INTERVAL '30 days')`, [getWorkspaceId()]);
    return true;
  }
  const now = Date.now();
  if (keys.some((key) => { const row = localResetLimits.get(key); return row && row.blockedUntil > now; })) return false;
  for (const key of keys) {
    const row = localResetLimits.get(key);
    const failures = !row || row.windowStartedAt < now - RESET_WINDOW_MS ? 1 : row.failures + 1;
    localResetLimits.set(key, { failures, windowStartedAt: !row || row.windowStartedAt < now - RESET_WINDOW_MS ? now : row.windowStartedAt, blockedUntil: failures >= RESET_MAX_REQUESTS ? now + RESET_WINDOW_MS : 0 });
  }
  if (localResetLimits.size > 10_000) for (const [key, row] of localResetLimits) if (row.windowStartedAt < now - RESET_WINDOW_MS) localResetLimits.delete(key);
  return true;
}

export async function createPasswordResetRequest(email: string, ip: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const allowed = await allowResetRequest(normalizedEmail, ip);
  if (!allowed) return { token: null as string | null, allowed: false };
  const user = await getAuthUser(normalizedEmail);
  const token = randomBytes(32).toString("base64url");
  const tokenHash = digest(token);
  const expiresAt = Date.now() + 30 * 60 * 1000;
  if (process.env.DATABASE_URL) {
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      if (user) {
        await client.query(`SELECT "id" FROM "User" WHERE "id" = $1 FOR UPDATE`, [user.id]);
        await client.query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "userId" = $2 AND "usedAt" IS NULL`, [getWorkspaceId(), user.id]);
      }
      await client.query(`INSERT INTO "PasswordResetToken" ("id", "workspaceId", "userId", "tokenHash", "requestIp", "createdAt", "expiresAt")
        VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,$6)`, [randomUUID(), getWorkspaceId(), user?.id ?? null, tokenHash, ip.slice(0, 128) || null, new Date(expiresAt)]);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  } else {
    if (localResetTokens.size > 10_000) for (const [key, reset] of localResetTokens) if (reset.usedAt || reset.expiresAt < Date.now()) localResetTokens.delete(key);
    for (const reset of localResetTokens.values()) if (reset.userId === user?.id && reset.email === normalizedEmail) reset.usedAt ??= Date.now();
    localResetTokens.set(tokenHash, { userId: user?.id ?? null, email: normalizedEmail, expiresAt, usedAt: null });
  }
  return { token, allowed: true };
}

export function passwordResetEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.PASSWORD_RESET_FROM && process.env.APP_BASE_URL);
}

export async function invalidatePasswordResetToken(token: string) {
  const tokenHash = digest(token);
  if (process.env.DATABASE_URL) await getPostgresPool().query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "tokenHash" = $1 AND "usedAt" IS NULL`, [tokenHash]);
  else {
    const reset = localResetTokens.get(tokenHash);
    if (reset) reset.usedAt = Date.now();
  }
}

export async function invalidatePasswordResetTokensForUser(email: string) {
  const user = await getAuthUser(email);
  if (!user) return;
  if (process.env.DATABASE_URL) await getPostgresPool().query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "userId" = $2 AND "usedAt" IS NULL`, [getWorkspaceId(), user.id]);
  else for (const reset of localResetTokens.values()) if (reset.userId === user.id) reset.usedAt ??= Date.now();
}

export async function sendPasswordResetEmail(email: string, token: string) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.PASSWORD_RESET_FROM;
  const baseUrl = process.env.APP_BASE_URL;
  if (!apiKey || !from || !baseUrl) throw new Error("Password reset email is not configured.");
  const base = new URL(baseUrl);
  const validProtocol = base.protocol === "https:" || (process.env.NODE_ENV !== "production" && base.protocol === "http:" && ["localhost", "127.0.0.1"].includes(base.hostname));
  if (!validProtocol || base.username || base.password || base.search || base.hash || /[\r\n]/.test(from)) throw new Error("Use a clean HTTPS application URL and safe sender address for password reset email.");
  const resetUrl = `${base.toString().replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Reset your Relay CRM password",
      text: `If an account exists for this email, you can reset its password using this one-time link. The link expires in 30 minutes.\n\n${resetUrl}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>If an account exists for this email, you can reset its password using this one-time link. The link expires in 30 minutes.</p><p><a href="${resetUrl}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Password reset email delivery failed.");
}

export async function completePasswordReset(token: string, password: string) {
  if (password.length < 12 || password.length > 1024) throw new Error("Use a password between 12 and 1,024 characters.");
  const tokenHash = digest(token);
  if (process.env.DATABASE_URL) {
    const pool = getPostgresPool();
    const preflight = await pool.query(`SELECT 1 FROM "PasswordResetToken" WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`, [tokenHash]);
    if (!preflight.rows.length) return false;
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row>(`SELECT "id", "workspaceId", "userId", "requestIp" FROM "PasswordResetToken" WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP FOR UPDATE`, [tokenHash]);
      const reset = result.rows[0];
      if (!reset) { await client.query("ROLLBACK"); return false; }
      const resetId = String(reset.id);
      const userId = reset.userId == null ? null : String(reset.userId);
      const workspaceId = String(reset.workspaceId);
      const requestIp = reset.requestIp == null ? null : String(reset.requestIp);
      if (!userId) {
        await client.query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [resetId]);
        await client.query("COMMIT");
        return false;
      }
      const updated = await client.query<Row>(`UPDATE "User" u SET "passwordHash" = $3, "updatedAt" = CURRENT_TIMESTAMP
        WHERE u."id" = $1 AND u."active" = true AND EXISTS (SELECT 1 FROM "WorkspaceUser" wu WHERE wu."workspaceId" = $2 AND wu."userId" = u."id") RETURNING u."id"`, [userId, workspaceId, passwordHash]);
      if (!updated.rows.length) {
        await client.query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "id" = $1`, [resetId]);
        await client.query("COMMIT");
        return false;
      }
      await client.query(`UPDATE "PasswordResetToken" SET "usedAt" = CURRENT_TIMESTAMP WHERE "userId" = $1 AND "workspaceId" = $2 AND "usedAt" IS NULL`, [userId, workspaceId]);
      await client.query(`UPDATE "AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "userId" = $1 AND "workspaceId" = $2 AND "revokedAt" IS NULL`, [userId, workspaceId]);
      await client.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "sourceIp", "details", "createdAt")
        VALUES ($1,$2,$3,'AUTH_PASSWORD_RESET_COMPLETED','USER',$3,$4,'{}'::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, userId, requestIp]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
  }
  const reset = localResetTokens.get(tokenHash);
  if (!reset || reset.usedAt || reset.expiresAt <= Date.now() || !reset.userId || localResetInFlight.has(tokenHash)) return false;
  localResetInFlight.add(tokenHash);
  try {
    const user = await getAuthUser(reset.email);
    if (!user || user.id !== reset.userId) return false;
    await changeAccountPassword(reset.email, password);
    reset.usedAt = Date.now();
    for (const candidate of localResetTokens.values()) if (candidate.userId === reset.userId) candidate.usedAt ??= Date.now();
    await revokeAuthSessions(reset.email, "");
    return true;
  } finally { localResetInFlight.delete(tokenHash); }
}
