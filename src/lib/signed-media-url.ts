import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { getWorkspaceId } from "@/lib/postgres-pool";

type MediaUrlClaims = { messageId: string; userId: string; sessionId: string; workspaceId: string; expiresAt: number };

function signingKey() {
  const secret = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-only-change-me");
  if (!secret || (process.env.NODE_ENV === "production" && secret.length < 32)) throw new Error("Configure SESSION_SECRET with at least 32 random characters before signing media URLs.");
  return secret;
}

function signature(payload: string) {
  return createHmac("sha256", signingKey()).update(payload).digest("base64url");
}

export function createSignedMediaUrl(messageId: string, userId: string, sessionId: string, expiresAt: number) {
  const claims: MediaUrlClaims = { messageId, userId, sessionId, workspaceId: getWorkspaceId(), expiresAt };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `/api/messages/${encodeURIComponent(messageId)}/media?sig=${payload}.${signature(payload)}`;
}

export function verifySignedMediaUrl(value: string | null, expected: Omit<MediaUrlClaims, "expiresAt">) {
  if (!value || value.length > 2048) return false;
  const [payload, received, extra] = value.split(".");
  if (!payload || !received || extra) return false;
  let expectedSignature: string;
  try { expectedSignature = signature(payload); } catch { return false; }
  const actualBytes = Buffer.from(received);
  const expectedBytes = Buffer.from(expectedSignature);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as MediaUrlClaims;
    return claims.messageId === expected.messageId && claims.userId === expected.userId && claims.sessionId === expected.sessionId && claims.workspaceId === expected.workspaceId && Number.isSafeInteger(claims.expiresAt) && claims.expiresAt > Date.now();
  } catch { return false; }
}
