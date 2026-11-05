import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

type Row = QueryResultRow;

function encryptionKey() {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("Configure SESSION_SECRET with at least 32 random characters before storing credentials.");
  return createHash("sha256").update(`twilio-connection:${secret}`).digest();
}

export function encryptTwilioAuthToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptTwilioAuthToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored Twilio credential format is invalid. Re-enter the Auth Token.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored Twilio credential cannot be decrypted. Check SESSION_SECRET or re-enter the Auth Token.");
  }
}

export type TwilioCredentials = {
  accountSid: string;
  authToken: string;
  fromE164: string;
  accountId?: string;
};

export async function getTwilioCredentialsForNumber(numberId: string): Promise<TwilioCredentials | null> {
  if (!process.env.DATABASE_URL) {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    if (sid && token) return { accountSid: sid, authToken: token, fromE164: "" };
    return null;
  }

  const pool = getPostgresPool();
  const result = await pool.query<Row>(
    `SELECT n."id", n."e164Number", n."twilioAccountSid", n."twilioAuthTokenEncrypted",
            ta."id" AS "taId", ta."accountSid" AS "taAccountSid", ta."authTokenEncrypted" AS "taAuthTokenEncrypted"
     FROM "ChannelNumber" n
     LEFT JOIN "TwilioAccount" ta ON ta."id" = n."twilioAccountId"
     WHERE n."workspaceId" = $1 AND n."id" = $2 LIMIT 1`,
    [getWorkspaceId(), numberId],
  );

  const row = result.rows[0];
  if (!row) return null;

  const fromE164 = String(row.e164Number);
  const accountSid = String(row.taAccountSid || row.twilioAccountSid || process.env.TWILIO_ACCOUNT_SID || "");
  const encryptedToken = (row.taAuthTokenEncrypted || row.twilioAuthTokenEncrypted) as string | null;

  let authToken = "";
  if (encryptedToken) {
    authToken = decryptTwilioAuthToken(encryptedToken);
  } else if (process.env.TWILIO_AUTH_TOKEN) {
    authToken = process.env.TWILIO_AUTH_TOKEN;
  }

  if (!accountSid || !authToken) return null;
  return { accountSid, authToken, fromE164, accountId: row.taId ? String(row.taId) : undefined };
}

export async function getTwilioCredentialsByAccountSid(accountSid: string): Promise<string | null> {
  if (!process.env.DATABASE_URL) {
    if (process.env.TWILIO_ACCOUNT_SID === accountSid) return process.env.TWILIO_AUTH_TOKEN || null;
    return null;
  }

  const pool = getPostgresPool();
  const result = await pool.query<Row>(
    `SELECT "authTokenEncrypted" FROM "TwilioAccount" WHERE "workspaceId" = $1 AND "accountSid" = $2 LIMIT 1`,
    [getWorkspaceId(), accountSid],
  );

  const row = result.rows[0];
  if (row?.authTokenEncrypted) {
    return decryptTwilioAuthToken(String(row.authTokenEncrypted));
  }

  if (process.env.TWILIO_ACCOUNT_SID === accountSid) {
    return process.env.TWILIO_AUTH_TOKEN || null;
  }

  return null;
}

export async function saveTwilioAccount(input: {
  friendlyName: string;
  accountSid: string;
  authToken: string;
}): Promise<{ id: string; friendlyName: string; accountSid: string }> {
  const pool = getPostgresPool();
  const workspaceId = getWorkspaceId();
  const cleanSid = input.accountSid.trim();
  const cleanName = input.friendlyName.trim() || `Twilio (${cleanSid.slice(-4)})`;
  const encrypted = encryptTwilioAuthToken(input.authToken.trim());

  const result = await pool.query<Row>(
    `INSERT INTO "TwilioAccount" ("id", "workspaceId", "friendlyName", "accountSid", "authTokenEncrypted", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("workspaceId", "accountSid")
     DO UPDATE SET "friendlyName" = EXCLUDED."friendlyName", "authTokenEncrypted" = EXCLUDED."authTokenEncrypted", "updatedAt" = CURRENT_TIMESTAMP
     RETURNING "id", "friendlyName", "accountSid"`,
    [randomUUID(), workspaceId, cleanName, cleanSid, encrypted],
  );

  const row = result.rows[0];
  return { id: String(row.id), friendlyName: String(row.friendlyName), accountSid: String(row.accountSid) };
}

export async function listTwilioAccounts(): Promise<{ id: string; friendlyName: string; accountSid: string; numberCount: number }[]> {
  if (!process.env.DATABASE_URL) return [];
  const pool = getPostgresPool();
  const result = await pool.query<Row>(
    `SELECT ta."id", ta."friendlyName", ta."accountSid",
            (SELECT COUNT(*)::int FROM "ChannelNumber" n WHERE n."twilioAccountId" = ta."id") AS "numberCount"
     FROM "TwilioAccount" ta
     WHERE ta."workspaceId" = $1
     ORDER BY ta."createdAt" ASC`,
    [getWorkspaceId()],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    friendlyName: String(row.friendlyName),
    accountSid: String(row.accountSid),
    numberCount: Number(row.numberCount || 0),
  }));
}

export async function testTwilioConnection(accountSid: string, authToken: string): Promise<{ ok: boolean; friendlyName?: string; error?: string }> {
  try {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid.trim())}.json`, {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid.trim()}:${authToken.trim()}`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => null) as { message?: string } | null;
      return { ok: false, error: data?.message || `Twilio returned HTTP ${response.status}` };
    }

    const data = await response.json() as { friendly_name?: string; status?: string };
    return { ok: true, friendlyName: data.friendly_name || "Active" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Connection timed out" };
  }
}

