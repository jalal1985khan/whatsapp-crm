import "server-only";

import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { authenticateOwner, getAuthUser } from "@/lib/crm-store";
import { getPostgresPool } from "@/lib/postgres-pool";
import { mfaLoginRequired, mfaStatus } from "@/lib/mfa";

const COOKIE = "crm_admin_session";
const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-only-change-me");
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
type LocalLoginAttempt = { failures: number; windowStartedAt: number; blockedUntil: number };
type LocalAuthSession = { userId: string; email: string; sourceIp: string; userAgent: string; createdAt: number; lastSeenAt: number; expiresAt: number; revokedAt: number | null };
// Next.js bundles pages and API routes separately, so local-mode state lives on globalThis to be shared between them.
const globalAuth = globalThis as typeof globalThis & { __relayCrmLocalLoginAttempts?: Map<string, LocalLoginAttempt>; __relayCrmLocalAuthSessions?: Map<string, LocalAuthSession> };
const localLoginAttempts = globalAuth.__relayCrmLocalLoginAttempts ??= new Map<string, LocalLoginAttempt>();
const localAuthSessions = globalAuth.__relayCrmLocalAuthSessions ??= new Map<string, LocalAuthSession>();
let loginAttemptCount = 0;

function signature(payload: string) {
  if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32)) throw new Error("SESSION_SECRET must be set to a random value of at least 32 characters before running in production.");
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

type Session = { sid: string; userId: string; email: string; name: string; role: string; exp: number; mfaVerifiedAt?: number };

function signedSessionFromCookie(value?: string) {
  if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32) || !value) return null;
  const [payload, received] = value.split(".");
  if (!payload || !received) return null;
  const expected = signature(payload);
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Session;
    return typeof session.sid === "string" && typeof session.userId === "string" && typeof session.email === "string" && session.exp > Date.now() ? session : null;
  } catch { return null; }
}

export async function createSession(email: string, name: string, role = "Owner", metadata: { sourceIp?: string; userAgent?: string; mfaVerified?: boolean } = {}) {
  const current = await getAuthUser(email);
  if (!current) throw new Error("The account is not active in this workspace.");
  const sid = randomBytes(24).toString("base64url");
  const now = Date.now();
  const exp = now + 1000 * 60 * 60 * 12;
  const sourceIp = metadata.sourceIp?.slice(0, 128) ?? "";
  const userAgent = metadata.userAgent?.slice(0, 512) ?? "";
  const payload = Buffer.from(JSON.stringify({ sid, userId: current.id, email: current.email, name, role, exp, ...(metadata.mfaVerified ? { mfaVerifiedAt: now } : {}) } satisfies Session)).toString("base64url");
  const cookieValue = `${payload}.${signature(payload)}`;
  if (process.env.DATABASE_URL) {
    const { getWorkspaceId } = await import("@/lib/postgres-pool");
    const workspaceId = getWorkspaceId();
    const pool = getPostgresPool();
    await pool.query(`INSERT INTO "AuthSession" ("id", "workspaceId", "userId", "sourceIp", "userAgent", "createdAt", "lastSeenAt", "expiresAt")
      VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,$6)`, [sid, getWorkspaceId(), current.id, sourceIp || null, userAgent || null, new Date(exp)]);
    try {
      await pool.query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "sourceIp", "userAgent", "createdAt")
        VALUES ($1,$2,$3,'AUTH_SESSION_CREATED','AUTH_SESSION',$4,$5,$6,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, current.id, sid, sourceIp || null, userAgent || null]);
    } catch {}
  } else {
    localAuthSessions.set(sid, { userId: current.id, email: current.email, sourceIp, userAgent, createdAt: now, lastSeenAt: now, expiresAt: exp, revokedAt: null });
  }
  const jar = await cookies();
  jar.set(COOKIE, cookieValue, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 60 * 60 * 12 });
}

export async function getSession() {
  const jar = await cookies();
  const session = signedSessionFromCookie(jar.get(COOKIE)?.value);
  if (!session) return null;
  try {
    const current = await getAuthUser(session.email);
    if (!current || current.id !== session.userId || current.name !== session.name || current.role !== session.role) {
      if (process.env.DATABASE_URL) await getPostgresPool().query(`UPDATE "AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "userId" = $2 AND "revokedAt" IS NULL`, [session.sid, session.userId]);
      else {
        const local = localAuthSessions.get(session.sid);
        if (local) local.revokedAt = Date.now();
      }
      return null;
    }
    if (process.env.DATABASE_URL) {
      const { getWorkspaceId } = await import("@/lib/postgres-pool");
      const pool = getPostgresPool();
      const result = await pool.query(`SELECT "lastSeenAt" FROM "AuthSession" WHERE "id" = $1 AND "workspaceId" = $2 AND "userId" = $3 AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP`, [session.sid, getWorkspaceId(), current.id]);
      if (!result.rows.length) return null;
      await pool.query(`UPDATE "AuthSession" SET "lastSeenAt" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "lastSeenAt" < CURRENT_TIMESTAMP - INTERVAL '5 minutes'`, [session.sid]);
    } else {
      const local = localAuthSessions.get(session.sid);
      if (!local || local.revokedAt || local.expiresAt <= Date.now() || local.userId !== current.id) return null;
      local.lastSeenAt = Date.now();
    }
    return session;
  } catch {
    return null;
  }
}

export async function listAuthSessions(email: string, currentSessionId: string) {
  const user = await getAuthUser(email);
  if (!user) return [];
  if (process.env.DATABASE_URL) {
    const { getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = await getPostgresPool().query(`SELECT "id", "sourceIp", "userAgent", "createdAt", "lastSeenAt", "expiresAt"
      FROM "AuthSession" WHERE "workspaceId" = $1 AND "userId" = $2 AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP ORDER BY "lastSeenAt" DESC`, [getWorkspaceId(), user.id]);
    return result.rows.map((row) => ({ id: String(row.id), sourceIp: row.sourceIp == null ? null : String(row.sourceIp), userAgent: row.userAgent == null ? null : String(row.userAgent), createdAt: row.createdAt, lastSeenAt: row.lastSeenAt, expiresAt: row.expiresAt, current: String(row.id) === currentSessionId }));
  }
  return [...localAuthSessions.entries()].filter(([, item]) => item.userId === user.id && !item.revokedAt && item.expiresAt > Date.now()).map(([id, item]) => ({ id, sourceIp: item.sourceIp || null, userAgent: item.userAgent || null, createdAt: new Date(item.createdAt).toISOString(), lastSeenAt: new Date(item.lastSeenAt).toISOString(), expiresAt: new Date(item.expiresAt).toISOString(), current: id === currentSessionId })).sort((a, b) => String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)));
}

export async function revokeAuthSessions(email: string, currentSessionId: string, targetSessionId?: string) {
  const user = await getAuthUser(email);
  if (!user) return 0;
  if (process.env.DATABASE_URL) {
    const { getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = targetSessionId
      ? await getPostgresPool().query(`UPDATE "AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "id" = $1 AND "workspaceId" = $2 AND "userId" = $3 AND "revokedAt" IS NULL RETURNING "id"`, [targetSessionId, getWorkspaceId(), user.id])
      : await getPostgresPool().query(`UPDATE "AuthSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "workspaceId" = $1 AND "userId" = $2 AND "id" <> $3 AND "revokedAt" IS NULL RETURNING "id"`, [getWorkspaceId(), user.id, currentSessionId]);
    if (result.rows.length) try {
      await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id", "workspaceId", "actorUserId", "action", "targetType", "targetId", "details", "createdAt")
        VALUES ($1,$2,$3,'AUTH_SESSIONS_REVOKED','AUTH_SESSION',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), user.id, targetSessionId ?? null, JSON.stringify({ count: result.rows.length, revokedOtherSessions: !targetSessionId })]);
    } catch {}
    return result.rows.length;
  }
  let revoked = 0;
  for (const [id, item] of localAuthSessions) {
    if (item.userId === user.id && !item.revokedAt && (targetSessionId ? id === targetSessionId : id !== currentSessionId)) {
      item.revokedAt = Date.now(); revoked += 1;
    }
  }
  return revoked;
}

export async function requireOwner() {
  const session = await getSession();
  return session?.role === "Owner" || session?.role === "Admin" ? session : null;
}

export async function requireMfaForAdminChange() {
  const session = await requireOwner();
  if (!session) return { session: null, needsMfa: false };
  if (session.role !== "Owner" && session.role !== "Admin") return { session, needsMfa: false };
  const status = await mfaStatus(session.email);
  return { session, needsMfa: !status.enabled || !session.mfaVerifiedAt };
}

export function mfaAdminActionMessage(action: string) {
  return `Set up an authenticator in Account security if needed, then sign in again with an authenticator code before ${action}.`;
}

export async function markCurrentSessionMfaVerified() {
  const jar = await cookies();
  const session = signedSessionFromCookie(jar.get(COOKIE)?.value);
  if (!session) throw new Error("Sign in again before completing MFA setup.");
  const updated = { ...session, mfaVerifiedAt: Date.now() } satisfies Session;
  const payload = Buffer.from(JSON.stringify(updated)).toString("base64url");
  jar.set(COOKIE, `${payload}.${signature(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: Math.max(0, Math.floor((session.exp - Date.now()) / 1000)) });
}

export async function loginOwner(email: string, password: string) {
  return authenticateOwner(email, password);
}

export async function isMfaRequired(email: string, role: string) { return mfaLoginRequired(email, role); }

const MFA_CHALLENGE_COOKIE = "crm_mfa_challenge";
type MfaChallenge = { email: string; name: string; role: string; exp?: number };
export async function createMfaChallenge(user: MfaChallenge) {
  const jar = await cookies();
  const payload = Buffer.from(JSON.stringify({ ...user, exp: Date.now() + 5 * 60_000 })).toString("base64url");
  jar.set(MFA_CHALLENGE_COOKIE, `${payload}.${signature(payload)}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/auth/mfa/challenge", maxAge: 300 });
}
export async function readMfaChallenge() {
  const jar = await cookies(); const value = jar.get(MFA_CHALLENGE_COOKIE)?.value;
  if (!value) return null;
  const [payload, received] = value.split("."); if (!payload || !received) return null;
  const expected = Buffer.from(signature(payload)); const actual = Buffer.from(received);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MfaChallenge; return data.email && data.name && data.role && typeof data.exp === "number" && data.exp > Date.now() ? data as Required<MfaChallenge> : null; } catch { return null; }
}
export async function clearMfaChallenge() { (await cookies()).set(MFA_CHALLENGE_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/api/auth/mfa/challenge", maxAge: 0 }); }

function rateLimitKey(email: string, clientIp: string) {
  return createHash("sha256").update(`${email.trim().toLowerCase()}\n${clientIp}`).digest("hex");
}

export async function loginRateLimit(email: string, clientIp: string) {
  const key = rateLimitKey(email, clientIp);
  if (process.env.DATABASE_URL) {
    const result = await getPostgresPool().query<{ blockedUntil: Date | string | null }>(`SELECT "blockedUntil" FROM "LoginRateLimit" WHERE "keyHash" = $1`, [key]);
    const blockedUntil = result.rows[0]?.blockedUntil;
    return blockedUntil && new Date(blockedUntil).getTime() > Date.now() ? Math.ceil((new Date(blockedUntil).getTime() - Date.now()) / 1000) : 0;
  }
  const current = localLoginAttempts.get(key);
  if (!current || current.windowStartedAt < Date.now() - LOGIN_WINDOW_MS) return 0;
  return current.blockedUntil > Date.now() ? Math.ceil((current.blockedUntil - Date.now()) / 1000) : 0;
}

export async function recordLoginFailure(email: string, clientIp: string) {
  const key = rateLimitKey(email, clientIp);
  if (process.env.DATABASE_URL) {
    await getPostgresPool().query(`INSERT INTO "LoginRateLimit" ("keyHash", "failureCount", "windowStartedAt", "blockedUntil", "updatedAt")
      VALUES ($1,1,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)
      ON CONFLICT ("keyHash") DO UPDATE SET
        "failureCount" = CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE "LoginRateLimit"."failureCount" + 1 END,
        "windowStartedAt" = CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN CURRENT_TIMESTAMP ELSE "LoginRateLimit"."windowStartedAt" END,
        "blockedUntil" = CASE WHEN (CASE WHEN "LoginRateLimit"."windowStartedAt" < CURRENT_TIMESTAMP - INTERVAL '15 minutes' THEN 1 ELSE "LoginRateLimit"."failureCount" + 1 END) >= $2 THEN CURRENT_TIMESTAMP + INTERVAL '15 minutes' ELSE NULL END,
        "updatedAt" = CURRENT_TIMESTAMP`, [key, LOGIN_MAX_FAILURES]);
    loginAttemptCount += 1;
    if (loginAttemptCount % 100 === 0) await getPostgresPool().query(`DELETE FROM "LoginRateLimit" WHERE "updatedAt" < CURRENT_TIMESTAMP - INTERVAL '2 days'`);
    return;
  }
  const now = Date.now();
  const current = localLoginAttempts.get(key);
  const failures = !current || current.windowStartedAt < now - LOGIN_WINDOW_MS ? 1 : current.failures + 1;
  localLoginAttempts.set(key, { failures, windowStartedAt: !current || current.windowStartedAt < now - LOGIN_WINDOW_MS ? now : current.windowStartedAt, blockedUntil: failures >= LOGIN_MAX_FAILURES ? now + LOGIN_WINDOW_MS : 0 });
  if (localLoginAttempts.size > 10_000) for (const [attemptKey, attempt] of localLoginAttempts) if (attempt.windowStartedAt < now - LOGIN_WINDOW_MS) localLoginAttempts.delete(attemptKey);
}

export async function clearLoginFailures(email: string, clientIp: string) {
  const key = rateLimitKey(email, clientIp);
  if (process.env.DATABASE_URL) await getPostgresPool().query(`DELETE FROM "LoginRateLimit" WHERE "keyHash" = $1`, [key]);
  else localLoginAttempts.delete(key);
}

export async function destroySession() {
  const jar = await cookies();
  const session = signedSessionFromCookie(jar.get(COOKIE)?.value);
  if (session) {
    if (process.env.DATABASE_URL) await revokeAuthSessions(session.email, session.sid, session.sid).catch(() => undefined);
    else {
      const local = localAuthSessions.get(session.sid);
      if (local) local.revokedAt = Date.now();
    }
  }
  jar.delete(COOKIE);
}
