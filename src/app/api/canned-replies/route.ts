import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { mfaAdminActionMessage, requireMfaForAdminChange, getSession } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;

function replyInput(body: Record<string, unknown>, fallback?: Row) {
  const titleValue = body.title === undefined ? fallback?.title : body.title;
  const textValue = body.body === undefined ? fallback?.body : body.body;
  const shortcutValue = body.shortcut === undefined ? fallback?.shortcut : body.shortcut;
  const sortValue = body.sortOrder === undefined ? fallback?.sortOrder : body.sortOrder;
  const activeValue = body.isActive === undefined ? fallback?.isActive : body.isActive;
  const title = typeof titleValue === "string" ? titleValue.trim() : "";
  const text = typeof textValue === "string" ? textValue.trim() : "";
  const shortcutText = typeof shortcutValue === "string" ? shortcutValue.trim().replace(/^;/, "").toLowerCase() : "";
  const shortcut = shortcutText || null;
  const sortOrder = Number(sortValue ?? 100);
  const isActive = activeValue === true || activeValue === false ? activeValue : fallback?.isActive === true;
  if (!title || title.length > 80) throw new Error("Give the reply a title of 1–80 characters.");
  if (!text || text.length > 4000) throw new Error("Reply text must be 1–4,000 characters.");
  if (shortcut && !/^[a-z0-9_-]{1,24}$/.test(shortcut)) throw new Error("Shortcut can use 1–24 lowercase letters, numbers, hyphens, or underscores.");
  if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 10000) throw new Error("Order must be a whole number from 0 to 10,000.");
  if (typeof activeValue !== "boolean") throw new Error("Choose whether this reply is active.");
  return { title, body: text, shortcut, sortOrder, isActive };
}

function serialize(row: Row) {
  return { id: String(row.id), title: String(row.title), shortcut: row.shortcut == null ? null : String(row.shortcut), body: String(row.body), sortOrder: Number(row.sortOrder), isActive: Boolean(row.isActive), updatedAt: new Date(String(row.updatedAt)).toISOString() };
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to load saved replies." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Saved replies require PostgreSQL." }, { status: 503 });
  const includeInactive = request.nextUrl.searchParams.get("includeInactive") === "1";
  if (includeInactive && session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  try {
    const result = await getPostgresPool().query<Row>(`SELECT "id","title","shortcut","body","sortOrder","isActive","updatedAt" FROM "CannedReply" WHERE "workspaceId"=$1 ${includeInactive ? "" : "AND \"isActive\"=TRUE"} ORDER BY "sortOrder","title","id"`, [getWorkspaceId()]);
    return NextResponse.json({ replies: result.rows.map(serialize) }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Could not load saved replies. Apply the latest database migrations." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("managing saved replies") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Saved replies require PostgreSQL." }, { status: 503 });
  const raw = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!raw || Array.isArray(raw)) return NextResponse.json({ error: "Reply details are required." }, { status: 400 });
  let input: ReturnType<typeof replyInput>;
  try { input = replyInput(raw); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Check the reply details." }, { status: 400 }); }
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const id = randomUUID(); const workspaceId = getWorkspaceId();
    await client.query(`INSERT INTO "CannedReply" ("id","workspaceId","title","shortcut","body","sortOrder","isActive","createdByUserId","updatedByUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [id, workspaceId, input.title, input.shortcut, input.body, input.sortOrder, input.isActive, session.userId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","after","createdAt") VALUES ($1,$2,$3,'CANNED_REPLY_CREATED','CANNED_REPLY',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ title: input.title, shortcut: input.shortcut, isActive: input.isActive })]);
    await client.query("COMMIT");
    return NextResponse.json({ reply: { id, ...input, updatedAt: new Date().toISOString() } }, { status: 201 });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const code = (error as { code?: string })?.code;
    return NextResponse.json({ error: code === "23505" ? "That shortcut is already used by another active reply." : "Could not save reply." }, { status: code === "23505" ? 409 : 503 });
  } finally { client.release(); }
}

export async function PATCH(request: NextRequest) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("managing saved replies") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Saved replies require PostgreSQL." }, { status: 503 });
  const raw = await request.json().catch(() => null) as ({ id?: unknown } & Record<string, unknown>) | null;
  if (!raw || typeof raw.id !== "string" || !raw.id || raw.id.length > 128) return NextResponse.json({ error: "Choose a saved reply to update." }, { status: 400 });
  const client = await getPostgresPool().connect(); const workspaceId = getWorkspaceId();
  try {
    await client.query("BEGIN");
    const currentResult = await client.query<Row>(`SELECT "id","title","shortcut","body","sortOrder","isActive" FROM "CannedReply" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE`, [workspaceId, raw.id]);
    const current = currentResult.rows[0];
    if (!current) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Saved reply not found." }, { status: 404 }); }
    let input: ReturnType<typeof replyInput>;
    try { input = replyInput(raw, current); } catch (error) { await client.query("ROLLBACK"); return NextResponse.json({ error: error instanceof Error ? error.message : "Check the reply details." }, { status: 400 }); }
    await client.query(`UPDATE "CannedReply" SET "title"=$3,"shortcut"=$4,"body"=$5,"sortOrder"=$6,"isActive"=$7,"updatedByUserId"=$8,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, raw.id, input.title, input.shortcut, input.body, input.sortOrder, input.isActive, session.userId]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,'CANNED_REPLY_UPDATED','CANNED_REPLY',$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, raw.id, JSON.stringify({ title: current.title, shortcut: current.shortcut, isActive: current.isActive }), JSON.stringify({ title: input.title, shortcut: input.shortcut, isActive: input.isActive })]);
    await client.query("COMMIT");
    return NextResponse.json({ reply: { id: String(raw.id), ...input, updatedAt: new Date().toISOString() } });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const code = (error as { code?: string })?.code;
    return NextResponse.json({ error: code === "23505" ? "That shortcut is already used by another active reply." : "Could not update reply." }, { status: code === "23505" ? 409 : 503 });
  } finally { client.release(); }
}
