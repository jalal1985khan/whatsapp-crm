import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { getAuthUser } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

const master = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-only-change-me");
const local = new Map<string, { enabled: boolean; secret: string | null; pending: string | null; recovery: string[] }>();

function key() {
  if (!master || (process.env.NODE_ENV === "production" && master.length < 32)) throw new Error("SESSION_SECRET must be configured before using MFA.");
  return createHash("sha256").update(master).digest();
}
function encrypt(value: string) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`;
}
function decrypt(value: string) {
  const [iv, tag, data] = value.split(".");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
}
function base32(bytes: Buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; let out = "";
  for (const byte of bytes) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += alphabet[(value << (5 - bits)) & 31]; return out;
}
function decode32(input: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of input.replace(/=+$/g, "")) { const n = alphabet.indexOf(char); if (n < 0) throw new Error("Invalid MFA secret."); value = (value << 5) | n; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function codeFor(secret: string, step: number) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(step)); const hash = createHmac("sha1", decode32(secret)).update(msg).digest();
  const offset = hash[hash.length - 1] & 15; const number = (hash.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(number).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false;
  const step = Math.floor(Date.now() / 30_000);
  return [-1, 0, 1].some((delta) => { const expected = Buffer.from(codeFor(secret, step + delta)); const actual = Buffer.from(code); return expected.length === actual.length && timingSafeEqual(expected, actual); });
}
const recoveryHash = (code: string) => createHmac("sha256", key()).update(code.toUpperCase().replace(/-/g, "")).digest("hex");
async function record(email: string) {
  const user = await getAuthUser(email); if (!user) throw new Error("Account not found.");
  if (process.env.DATABASE_URL) {
    const r = await getPostgresPool().query(`SELECT "mfaEnabled" enabled, "mfaSecret" secret, "mfaPendingSecret" pending, "mfaRecoveryCodeHashes" recovery FROM "User" WHERE "id"=$1`, [user.id]);
    return { ...user, ...(r.rows[0] as { enabled: boolean; secret: string | null; pending: string | null; recovery: string[] }) };
  }
  const state = local.get(user.id) ?? { enabled: false, secret: null, pending: null, recovery: [] }; local.set(user.id, state);
  return { ...user, ...state };
}
async function save(email: string, state: { enabled: boolean; secret: string | null; pending: string | null; recovery: string[] }) {
  const user = await getAuthUser(email); if (!user) throw new Error("Account not found.");
  if (process.env.DATABASE_URL) await getPostgresPool().query(`UPDATE "User" SET "mfaEnabled"=$2,"mfaSecret"=$3,"mfaPendingSecret"=$4,"mfaRecoveryCodeHashes"=$5,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [user.id, state.enabled, state.secret, state.pending, state.recovery]);
  else local.set(user.id, state);
}
export async function mfaStatus(email: string) { const state = await record(email); return { enabled: state.enabled, pending: !!state.pending }; }
export async function beginMfa(email: string) {
  const user = await record(email); if (user.enabled) throw new Error("MFA is already enabled.");
  const secret = base32(randomBytes(20)); await save(email, { ...user, pending: encrypt(secret) });
  const label = encodeURIComponent(`${user.email} (Relay CRM)`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Relay%20CRM&algorithm=SHA1&digits=6&period=30` };
}
export async function beginMfaReplacement(email: string, code: string) {
  const user = await record(email);
  if (!user.enabled || !user.secret) throw new Error("Enable MFA before replacing its authenticator.");
  if (!(await consumeMfa(email, code))) throw new Error("Enter a valid current authenticator or unused recovery code to replace MFA.");
  const current = await record(email);
  const secret = base32(randomBytes(20));
  await save(email, { ...current, pending: encrypt(secret) });
  const label = encodeURIComponent(`${user.email} (Relay CRM)`);
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=Relay%20CRM&algorithm=SHA1&digits=6&period=30` };
}
export async function confirmMfa(email: string, code: string) {
  const user = await record(email); if (!user.pending) throw new Error("Start authenticator setup first.");
  const secret = decrypt(user.pending); if (!verifyTotp(secret, code)) throw new Error("That authenticator code is invalid or expired.");
  const codes = Array.from({ length: 10 }, () => randomBytes(5).toString("hex").toUpperCase().match(/.{1,5}/g)!.join("-"));
  await save(email, { enabled: true, secret: encrypt(secret), pending: null, recovery: codes.map(recoveryHash) });
  return codes;
}
export async function disableMfa(email: string, code: string) {
  const user = await record(email); if (!user.secret || !user.enabled || !(await consumeMfa(email, code))) throw new Error("The authenticator or recovery code is incorrect.");
  await save(email, { enabled: false, secret: null, pending: null, recovery: [] });
}
export async function consumeMfa(email: string, code: string) {
  const user = await record(email); if (!user.enabled || !user.secret) return false;
  const secret = decrypt(user.secret);
  if (verifyTotp(secret, code)) return true;
  const candidate = Buffer.from(recoveryHash(code), "hex"); const index = user.recovery.findIndex((item) => {
    const stored = Buffer.from(item, "hex");
    return stored.length === candidate.length && timingSafeEqual(stored, candidate);
  });
  if (index < 0) return false;
  const recovery = [...user.recovery]; recovery.splice(index, 1); await save(email, { ...user, recovery });
  if (process.env.DATABASE_URL) {
    await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'AUTH_MFA_RECOVERY_CODE_USED','USER',$3,'{}'::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), user.id]);
  }
  return true;
}
export async function mfaLoginRequired(email: string, role: string) {
  if (role !== "Owner" && role !== "Admin") return false;
  return (await record(email)).enabled;
}
