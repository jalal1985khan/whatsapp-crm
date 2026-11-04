import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

function mediaKey() {
  const secret = process.env.SESSION_SECRET || "";
  if (secret.length < 32) throw new Error("Configure SESSION_SECRET with at least 32 random characters before storing CRM media.");
  return createHash("sha256").update(`whatsapp-crm-media:${secret}`).digest();
}

export function encryptMedia(content: Uint8Array) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", mediaKey(), iv);
  const encrypted = Buffer.concat([cipher.update(content), cipher.final()]);
  return Buffer.concat([Buffer.from([1]), iv, cipher.getAuthTag(), encrypted]);
}

export function decryptMedia(value: Uint8Array) {
  const payload = Buffer.from(value);
  if (payload.length < 29 || payload[0] !== 1) throw new Error("Stored attachment is invalid or uses an unsupported encryption version.");
  const iv = payload.subarray(1, 13); const tag = payload.subarray(13, 29); const encrypted = payload.subarray(29);
  try {
    const decipher = createDecipheriv("aes-256-gcm", mediaKey(), iv); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch { throw new Error("Stored attachment could not be decrypted. Check SESSION_SECRET before accessing archived media."); }
}

export function mediaSha256(content: Uint8Array) {
  return createHash("sha256").update(content).digest("hex");
}
