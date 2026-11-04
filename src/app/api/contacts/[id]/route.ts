import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { getSession } from "@/lib/auth";
import { updateLocalContact } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { canAccessContactRecord, getScopedInboxSnapshot } from "@/lib/inbox-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Row = QueryResultRow;
type ContactInput = { name?: unknown; phone?: unknown; email?: unknown; source?: unknown; ownerUserId?: unknown; tags?: unknown; customFields?: unknown };

function validFields(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length <= 30 && entries.every(([key, item]) => key.trim().length > 0 && key.length <= 80 && (typeof item === "string" || typeof item === "number" || typeof item === "boolean" || item === null) && (typeof item !== "string" || item.length <= 500)) && Buffer.byteLength(JSON.stringify(value)) <= 8000;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to update customer details." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required to edit customer profiles." }, { status: 403 });
  const { id } = await context.params;
  if (!(await canAccessContactRecord(session, id))) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  const body = await request.json().catch(() => null) as ContactInput | null;
  const name = typeof body?.name === "string" ? body.name.trim().slice(0, 160) : "";
  const phone = typeof body?.phone === "string" ? body.phone.replace(/[\s()-]/g, "") : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const source = typeof body?.source === "string" ? body.source.trim() : "";
  const ownerUserId = typeof body?.ownerUserId === "string" && body.ownerUserId ? body.ownerUserId : null;
  const tags = Array.isArray(body?.tags) ? [...new Set(body.tags.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim()).filter(Boolean))] : [];
  const customFields = body?.customFields;
  if (!name) return NextResponse.json({ error: "Customer name is required." }, { status: 400 });
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return NextResponse.json({ error: "Enter a phone number in international format, such as +14155550123." }, { status: 400 });
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  if (source.length > 200) return NextResponse.json({ error: "Source must be 200 characters or fewer." }, { status: 400 });
  if (tags.length > 30 || tags.some((tag) => tag.length > 32)) return NextResponse.json({ error: "Use up to 30 tags, each 32 characters or fewer." }, { status: 400 });
  if (!validFields(customFields)) return NextResponse.json({ error: "Custom fields must be an object with up to 30 short text, number, or yes/no values." }, { status: 400 });

  const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
  const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || null;
  try {
    if (!process.env.DATABASE_URL) {
      const chat = await updateLocalContact({ id, name, phone, email: email || null, source: source || null, ownerUserId, tags, customFields });
      return NextResponse.json({ chat });
    }
    const pool = getPostgresPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const workspaceId = getWorkspaceId();
      const result = await client.query<Row>(`SELECT "id","displayName","primaryPhone","email","source","ownerUserId","tags","customFields","mergedIntoContactId" FROM "Contact" WHERE "workspaceId"=$1 AND "id"=$2 FOR UPDATE`, [workspaceId, id]);
      const previous = result.rows[0];
      if (!previous) throw new Error("Customer not found.");
      if (previous.mergedIntoContactId) throw new Error("This record was merged. Open the retained customer record to edit it.");
      if (ownerUserId) {
        const owner = await client.query<Row>(`SELECT 1 FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND wu."userId"=$2 AND u."active"=TRUE`, [workspaceId, ownerUserId]);
        if (!owner.rows[0]) throw new Error("Choose an active owner in this workspace.");
      }
      if (phone !== String(previous.primaryPhone)) {
        const duplicate = await client.query<Row>(`SELECT c."id" FROM "Contact" c WHERE c."workspaceId"=$1 AND c."id"<>$3 AND (c."primaryPhone"=$2 OR EXISTS (SELECT 1 FROM "ContactIdentifier" ci WHERE ci."workspaceId"=$1 AND ci."contactId"=c."id" AND ci."type"='PHONE' AND ci."normalizedValue"=$2)) LIMIT 1`, [workspaceId, phone, id]);
        if (duplicate.rows[0]) throw new Error("A customer with this phone number already exists.");
        for (const [number, identifierSource] of [[String(previous.primaryPhone), "PREVIOUS_PRIMARY_PHONE"], [phone, "PROFILE_EDIT"]]) {
          await client.query(`INSERT INTO "ContactIdentifier" ("id","workspaceId","contactId","type","normalizedValue","verified","source","createdAt") VALUES ($1,$2,$3,'PHONE',$4,FALSE,$5,CURRENT_TIMESTAMP) ON CONFLICT ("contactId","type","normalizedValue") DO NOTHING`, [randomUUID(), workspaceId, id, number, identifierSource]);
        }
      }
      await client.query(`UPDATE "Contact" SET "displayName"=$3,"primaryPhone"=$4,"email"=$5,"source"=$6,"ownerUserId"=$7,"tags"=$8,"customFields"=$9::jsonb,"updatedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, id, name, phone, email || null, source || null, ownerUserId, tags, JSON.stringify(customFields)]);
      await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","before","after","createdAt") VALUES ($1,$2,$3,'CONTACT_PROFILE_UPDATED','CONTACT',$4,$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, sourceIp, JSON.stringify({ displayName: previous.displayName, primaryPhone: previous.primaryPhone, email: previous.email, source: previous.source, ownerUserId: previous.ownerUserId, tags: previous.tags, customFields: previous.customFields }), JSON.stringify({ displayName: name, primaryPhone: phone, email: email || null, source: source || null, ownerUserId, tags, customFields })]);
      await client.query("COMMIT");
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch {}
      throw error;
    } finally { client.release(); }
    const chat = (await getScopedInboxSnapshot(session, [id])).chats.find((item) => item.id === id);
    return NextResponse.json({ chat });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update customer details." }, { status: 400 });
  }
}
