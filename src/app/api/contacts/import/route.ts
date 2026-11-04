import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { QueryResultRow } from "pg";
import { requireOwner } from "@/lib/auth";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type InputRow = { row: number; name?: unknown; phone?: unknown; email?: unknown; source?: unknown; tags?: unknown; consent?: unknown; consentSource?: unknown; consentWordingVersion?: unknown };
type PreparedRow = { row: number; name: string; phone: string; email: string | null; source: string | null; tags: string[]; consent: "unknown" | "opted_in" | "opted_out"; consentSource: string | null; consentWordingVersion: string | null; errors: string[]; duplicates: string[] };

function asText(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

function prepareRows(rows: InputRow[]): PreparedRow[] {
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();
  return rows.map((item, index) => {
    const name = asText(item.name).slice(0, 160);
    const phone = asText(item.phone).replace(/[\s().-]/g, "");
    const rawEmail = asText(item.email).toLowerCase();
    const email = rawEmail || null;
    const source = asText(item.source).slice(0, 200) || null;
    const tags = [...new Set(asText(item.tags).split("|").map((tag) => tag.trim()).filter(Boolean))];
    const consentValue = asText(item.consent).toLowerCase();
    const consent = consentValue === "opted_in" || consentValue === "opted_out" ? consentValue : consentValue === "" || consentValue === "unknown" ? "unknown" : "unknown";
    const consentSource = asText(item.consentSource).slice(0, 300) || null;
    const consentWordingVersion = asText(item.consentWordingVersion).slice(0, 100) || null;
    const errors: string[] = [];
    const duplicates: string[] = [];
    if (!name) errors.push("Name is required.");
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) errors.push("Phone must be in international E.164 format.");
    if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) errors.push("Email is invalid.");
    if (tags.length > 30 || tags.some((tag) => tag.length > 32)) errors.push("Use at most 30 tags, each up to 32 characters; separate tags with |.");
    if (consentValue && !["opted_in", "opted_out", "unknown"].includes(consentValue)) errors.push("Consent must be opted_in, opted_out, or unknown.");
    if (consent !== "unknown" && !consentSource) errors.push("Explicit consent requires consent_source evidence.");
    if (consent !== "unknown" && !consentWordingVersion) errors.push("Explicit consent requires consent_wording_version.");
    if (!errors.length) {
      if (seenPhones.has(phone)) duplicates.push("Phone is repeated in this file.");
      seenPhones.add(phone);
      if (email && seenEmails.has(email)) duplicates.push("Email is repeated in this file.");
      if (email) seenEmails.add(email);
    }
    return { row: Number.isInteger(item.row) && Number(item.row) > 0 ? Number(item.row) : index + 2, name, phone, email, source, tags, consent, consentSource, consentWordingVersion, errors, duplicates };
  });
}

async function findExisting(rows: PreparedRow[], queryable: { query: (text: string, values: unknown[]) => Promise<{ rows: QueryResultRow[] }> } = getPostgresPool()) {
  const valid = rows.filter((row) => !row.errors.length);
  if (!valid.length) return new Map<string, string[]>();
  const phones = [...new Set(valid.map((row) => row.phone))];
  const emails = [...new Set(valid.map((row) => row.email).filter((value): value is string => Boolean(value)))];
  const result = await queryable.query(`SELECT c."id",c."displayName",c."primaryPhone",c."email",ci."normalizedValue" AS "identifierPhone"
    FROM "Contact" c LEFT JOIN "ContactIdentifier" ci ON ci."workspaceId"=c."workspaceId" AND ci."contactId"=c."id" AND ci."type"='PHONE'
    WHERE c."workspaceId"=$1 AND c."mergedIntoContactId" IS NULL AND (c."primaryPhone"=ANY($2::text[]) OR ci."normalizedValue"=ANY($2::text[]) OR lower(c."email")=ANY($3::text[]))`, [getWorkspaceId(), phones, emails]);
  const reasons = new Map<string, Set<string>>();
  for (const row of result.rows) {
    const matchingPhones = new Set([String(row.primaryPhone), row.identifierPhone == null ? "" : String(row.identifierPhone)]);
    for (const item of valid) {
      if (matchingPhones.has(item.phone)) { const set = reasons.get(`${item.row}`) ?? new Set<string>(); set.add(`Phone already belongs to ${String(row.displayName || row.primaryPhone)}.`); reasons.set(`${item.row}`, set); }
      if (item.email && row.email && item.email === String(row.email).toLowerCase()) { const set = reasons.get(`${item.row}`) ?? new Set<string>(); set.add(`Email already belongs to ${String(row.displayName || row.primaryPhone)}.`); reasons.set(`${item.row}`, set); }
    }
  }
  return new Map([...reasons.entries()].map(([key, value]) => [key, [...value]]));
}

export async function POST(request: NextRequest) {
  const session = await requireOwner();
  if (!session) return NextResponse.json({ error: "Administrator access required." }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "Contact imports require PostgreSQL." }, { status: 503 });
  const body = await request.json().catch(() => null) as { mode?: string; rows?: unknown[]; selectedRows?: unknown[] } | null;
  if (!body || !["preview", "commit"].includes(body.mode ?? "") || !Array.isArray(body.rows) || body.rows.length < 1 || body.rows.length > 500 || body.rows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) return NextResponse.json({ error: "Upload between 1 and 500 customer rows and choose preview or import." }, { status: 400 });
  const rows = prepareRows(body.rows as InputRow[]);
  const existing = await findExisting(rows);
  for (const row of rows) row.duplicates.push(...(existing.get(String(row.row)) ?? []));
  if (body.mode === "preview") return NextResponse.json({ rows, summary: { total: rows.length, valid: rows.filter((row) => !row.errors.length && !row.duplicates.length).length, invalid: rows.filter((row) => row.errors.length).length, duplicates: rows.filter((row) => row.duplicates.length).length } });

  const selectedRows = new Set(Array.isArray(body.selectedRows) ? body.selectedRows.filter((value): value is number => Number.isInteger(value)) : []);
  const toImport = rows.filter((row) => selectedRows.has(row.row));
  if (!toImport.length) return NextResponse.json({ error: "Select at least one valid, non-duplicate row to import." }, { status: 400 });
  const bad = toImport.filter((row) => row.errors.length || row.duplicates.length);
  if (bad.length) return NextResponse.json({ error: "Selected rows contain validation errors or duplicates. Refresh the preview and select only valid new customers.", rows: bad }, { status: 409 });

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`contact-import:${workspaceId}`]);
    const freshExisting = await findExisting(toImport, client);
    if (freshExisting.size) throw new Error("One or more selected customers now match a record in the workspace. Refresh the preview before importing.");
    for (const row of toImport) {
      const id = randomUUID();
      await client.query(`INSERT INTO "Contact" ("id","workspaceId","displayName","primaryPhone","email","source","tags","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`, [id, workspaceId, row.name, row.phone, row.email, row.source, row.tags]);
      await client.query(`INSERT INTO "ContactIdentifier" ("id","workspaceId","contactId","type","normalizedValue","verified","source","createdAt") VALUES ($1,$2,$3,'PHONE',$4,FALSE,'CONTACT_IMPORT',CURRENT_TIMESTAMP) ON CONFLICT ("contactId","type","normalizedValue") DO NOTHING`, [randomUUID(), workspaceId, id, row.phone]);
      if (row.consent !== "unknown") {
        const consentStatus = row.consent === "opted_in" ? "OPTED_IN" : "OPTED_OUT";
        await client.query(`INSERT INTO "ConsentRecord" ("id","workspaceId","contactId","channel","scope","status","wordingVersion","evidenceSource","capturedAt","capturedByUserId") VALUES ($1,$2,$3,'WHATSAPP','WHATSAPP_MESSAGING',$4::"ConsentStatus",$5,$6,CURRENT_TIMESTAMP,$7)`, [randomUUID(), workspaceId, id, consentStatus, row.consentWordingVersion, row.consentSource, session.userId]);
        await client.query(`UPDATE "Contact" SET "suppressionState"=$3,"suppressedAt"=CASE WHEN $3='OPTED_OUT' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, id, consentStatus]);
      }
    }
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
    const sourceIp = (request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || "").slice(0, 128) || null;
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","details","createdAt") VALUES ($1,$2,$3,'CONTACTS_IMPORTED','WORKSPACE',$2,$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, sourceIp, JSON.stringify({ count: toImport.length, rowsWithConsent: toImport.filter((row) => row.consent !== "unknown").length, source: "CSV" })]);
    await client.query("COMMIT");
    return NextResponse.json({ imported: toImport.length, skipped: rows.length - toImport.length });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    const message = error instanceof Error ? error.message : "Could not import contacts.";
    return NextResponse.json({ error: message }, { status: message.includes("match a record") ? 409 : 400 });
  } finally { client.release(); }
}
