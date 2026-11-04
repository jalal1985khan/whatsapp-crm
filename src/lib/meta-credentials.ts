import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

function encryptionKey() {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("Configure SESSION_SECRET with at least 32 random characters before connecting Meta accounts.");
  return createHash("sha256").update(`whatsapp-connection:${secret}`).digest();
}

export function encryptMetaAccessToken(token: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptMetaAccessToken(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Stored Meta connection credential is invalid. Reconnect this business account.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored Meta connection credential cannot be decrypted. Check SESSION_SECRET or reconnect this business account.");
  }
}

export async function metaTokenForNumber(numberId: string) {
  if (!process.env.DATABASE_URL) return process.env.META_ACCESS_TOKEN || null;
  const result = await getPostgresPool().query(`SELECT c."accessTokenEncrypted",c."tokenExpiresAt",c."status" FROM "ChannelNumber" n JOIN "WhatsAppConnection" c ON c."id"=n."whatsappConnectionId"
    WHERE n."workspaceId"=$1 AND n."id"=$2 LIMIT 1`, [getWorkspaceId(), numberId]);
  const row = result.rows[0];
  if (!row) return process.env.META_ACCESS_TOKEN || null;
  if (String(row.status) !== "ACTIVE") throw new Error("This WhatsApp business account connection is inactive. Reconnect it before sending.");
  if (row.tokenExpiresAt && new Date(String(row.tokenExpiresAt)).getTime() <= Date.now()) throw new Error("This Meta connection token has expired. Reconnect the WhatsApp business account.");
  return decryptMetaAccessToken(String(row.accessTokenEncrypted));
}

export async function metaTokenForWaba(wabaId: string) {
  if (!process.env.DATABASE_URL) return process.env.META_ACCESS_TOKEN || null;
  const result = await getPostgresPool().query(`SELECT "accessTokenEncrypted","tokenExpiresAt","status" FROM "WhatsAppConnection" WHERE "workspaceId"=$1 AND "wabaId"=$2 LIMIT 1`, [getWorkspaceId(), wabaId]);
  const row = result.rows[0];
  if (!row) return process.env.META_ACCESS_TOKEN || null;
  if (String(row.status) !== "ACTIVE") throw new Error("This WhatsApp business account connection is inactive. Reconnect it before syncing templates.");
  if (row.tokenExpiresAt && new Date(String(row.tokenExpiresAt)).getTime() <= Date.now()) throw new Error("This Meta connection token has expired. Reconnect the WhatsApp business account.");
  return decryptMetaAccessToken(String(row.accessTokenEncrypted));
}
