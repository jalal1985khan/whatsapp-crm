import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getSession, mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Policy = { deleteResolvedContactsAfterDays: number };
const emptyPolicy: Policy = { deleteResolvedContactsAfterDays: 0 };

function validPolicy(value: unknown): value is Policy {
  if (!value || typeof value !== "object") return false;
  const days = (value as { deleteResolvedContactsAfterDays?: unknown }).deleteResolvedContactsAfterDays;
  return Number.isInteger(days) && (days === 0 || (Number(days) >= 30 && Number(days) <= 3650));
}
function matchesSecret(received: string, expected: string) {
  const a = createHash("sha256").update(received).digest(); const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
async function policyFor(client: { query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }, workspaceId: string) {
  const result = await client.query(`SELECT "retentionPolicy" FROM "Workspace" WHERE "id"=$1`, [workspaceId]);
  const value = result.rows[0]?.retentionPolicy;
  const policy = typeof value === "string" ? JSON.parse(value) : value;
  const days = (policy as { deleteResolvedContactsAfterDays?: unknown } | null)?.deleteResolvedContactsAfterDays;
  return Number.isInteger(days) && Number(days) >= 30 && Number(days) <= 3650 ? { deleteResolvedContactsAfterDays: Number(days) } : emptyPolicy;
}

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to manage retention." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Retention settings require PostgreSQL." }, { status: 503 });
  try { return NextResponse.json({ policy: await policyFor(getPostgresPool(), getWorkspaceId()) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read retention settings." }, { status: 503 }); }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Sign in to manage retention." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required." }, { status: 403 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("changing customer retention settings") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Retention settings require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { policy?: unknown } | null;
  if (!body || !validPolicy(body.policy)) return NextResponse.json({ error: "Choose 0 to disable scheduled deletion, or a retention period from 30 to 3,650 days." }, { status: 400 });
  const pool = getPostgresPool(); const workspaceId = getWorkspaceId(); const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`SELECT "retentionPolicy" FROM "Workspace" WHERE "id"=$1 FOR UPDATE`, [workspaceId]);
    if (!result.rows.length) throw new Error("Workspace not found.");
    const previous = typeof result.rows[0].retentionPolicy === "string" ? JSON.parse(result.rows[0].retentionPolicy) : result.rows[0].retentionPolicy ?? {};
    await client.query(`UPDATE "Workspace" SET "retentionPolicy"=$2::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [workspaceId, JSON.stringify(body.policy)]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","userAgent","before","after","createdAt") VALUES ($1,$2,$3,'RETENTION_POLICY_CHANGED','WORKSPACE',$2,$4,$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, request.headers.get("x-real-ip")?.slice(0, 128) ?? null, request.headers.get("user-agent")?.slice(0, 512) ?? null, JSON.stringify(previous), JSON.stringify(body.policy)]);
    await client.query("COMMIT");
    return NextResponse.json({ policy: body.policy });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update retention settings." }, { status: 503 });
  } finally { client.release(); }
}

export async function POST(request: NextRequest) {
  const expected = process.env.RETENTION_CLEANUP_SECRET;
  if (!expected || expected.length < 32) return NextResponse.json({ error: "Retention cleanup is not configured." }, { status: 503 });
  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!matchesSecret(received, expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Retention cleanup requires PostgreSQL." }, { status: 503 });
  const pool = getPostgresPool(); const workspaceId = getWorkspaceId();
  try {
    const policy = await policyFor(pool, workspaceId);
    if (policy.deleteResolvedContactsAfterDays === 0) return NextResponse.json({ deleted: 0, disabled: true });
    const candidates = await pool.query<{ id: string }>(`SELECT c."id" FROM "Contact" c WHERE c."workspaceId"=$1 AND c."legalHoldAt" IS NULL
      AND EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=c."id")
      AND NOT EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=c."id" AND v."state" <> 'RESOLVED')
      AND COALESCE((SELECT MAX(v."lastMessageAt") FROM "Conversation" v WHERE v."contactId"=c."id"),c."createdAt") < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')
      ORDER BY c."createdAt" LIMIT 100`, [workspaceId, policy.deleteResolvedContactsAfterDays]);
    let deleted = 0;
    for (const candidate of candidates.rows) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const contact = await client.query<{ primaryPhone: string; legalHoldAt: Date | null }>(`SELECT "primaryPhone","legalHoldAt" FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2 FOR UPDATE`, [candidate.id, workspaceId]);
        if (!contact.rows.length || contact.rows[0].legalHoldAt) { await client.query("ROLLBACK"); continue; }
        const stillDue = await client.query(`SELECT 1 WHERE EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=$1) AND NOT EXISTS (SELECT 1 FROM "Conversation" v WHERE v."contactId"=$1 AND v."state" <> 'RESOLVED') AND COALESCE((SELECT MAX(v."lastMessageAt") FROM "Conversation" v WHERE v."contactId"=$1),CURRENT_TIMESTAMP) < CURRENT_TIMESTAMP - ($2::int * INTERVAL '1 day')`, [candidate.id, policy.deleteResolvedContactsAfterDays]);
        if (!stillDue.rows.length) { await client.query("ROLLBACK"); continue; }
        const messages = await client.query<{ platformMessageId: string | null }>(`SELECT "platformMessageId" FROM "Message" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "platformMessageId" IS NOT NULL`, [workspaceId, candidate.id]);
        const identifiers = [...new Set([contact.rows[0].primaryPhone.replace(/\D/g, ""), ...messages.rows.map((row) => row.platformMessageId).filter((value): value is string => !!value)])];
        for (const identifier of identifiers) await client.query(`UPDATE "WebhookEvent" SET "rawPayload"='{"redacted":true}'::jsonb,"errorSummary"=NULL,"processingState"='PROCESSED',"processedAt"=COALESCE("processedAt",CURRENT_TIMESTAMP) WHERE "workspaceId"=$1 AND "rawPayload" IS NOT NULL AND "rawPayload"::text LIKE $2`, [workspaceId, `%${identifier}%`]);
        await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,'CONTACT_RETENTION_DELETED','CONTACT',$3,$4::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, candidate.id, JSON.stringify({ retentionDays: policy.deleteResolvedContactsAfterDays, webhookPayloads: "redacted" })]);
        await client.query(`DELETE FROM "Contact" WHERE "id"=$1 AND "workspaceId"=$2`, [candidate.id, workspaceId]);
        await client.query("COMMIT"); deleted += 1;
      } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
      finally { client.release(); }
    }
    return NextResponse.json({ deleted, scanned: candidates.rows.length, limitReached: candidates.rows.length === 100 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Retention cleanup failed." }, { status: 503 }); }
}
