import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { checkMetaNumberIdentity } from "@/lib/meta-number-health";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = QueryResultRow;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("running a Meta number check") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Meta number checks require PostgreSQL." }, { status: 503 });
  const { id } = await context.params;
  const workspaceId = getWorkspaceId();
  const pool = getPostgresPool();
  const numberResult = await pool.query<Row>(`SELECT "id","label","e164Number","metaPhoneNumberId","metaWabaId","state" FROM "ChannelNumber" WHERE "id"=$1 AND "workspaceId"=$2`, [id, workspaceId]);
  const number = numberResult.rows[0];
  if (!number) return NextResponse.json({ error: "Number not found in this workspace." }, { status: 404 });
  if (!number.metaPhoneNumberId || !number.metaWabaId) return NextResponse.json({ error: "Add the Meta phone number ID and WABA ID before checking this number." }, { status: 400 });

  const check = await checkMetaNumberIdentity({ id, e164Number: String(number.e164Number), metaPhoneNumberId: String(number.metaPhoneNumberId), metaWabaId: String(number.metaWabaId) });

  await pool.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'CHANNEL_NUMBER_CONNECTION_CHECKED','CHANNEL_NUMBER',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ outcome: check.outcome, httpStatus: check.httpStatus, providerCode: check.providerCode, durationMs: check.durationMs, qualityRating: check.qualityRating, numberMatches: check.numberMatches, verifiedName: check.verifiedName, error: check.error })]);
  return NextResponse.json({ ...check, checkedAt: new Date().toISOString() }, { status: 200, headers: { "Cache-Control": "no-store" } });
}
