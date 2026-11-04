import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSession, mfaAdminActionMessage, requireMfaForAdminChange } from "@/lib/auth";
import { decryptMedia, mediaSha256 } from "@/lib/media-storage";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { verifySignedMediaUrl } from "@/lib/signed-media-url";
import { canAccessConversation } from "@/lib/inbox-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to view this attachment." }, { status: 401 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "CRM attachment storage requires PostgreSQL." }, { status: 503 });
  const { id } = await context.params;
  if (!verifySignedMediaUrl(new URL(request.url).searchParams.get("sig"), { messageId: id, userId: session.userId, sessionId: session.sid, workspaceId: getWorkspaceId() })) return NextResponse.json({ error: "This attachment link is invalid or expired. Refresh the inbox and try again." }, { status: 403, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  const result = await getPostgresPool().query(`SELECT a."filename",a."mimeType",a."sha256",a."encryptedContent",a."storageStatus",a."malwareScanStatus",m."contactId",m."channelNumberId" FROM "MessageAttachment" a JOIN "Message" m ON m."id"=a."messageId" WHERE a."workspaceId"=$1 AND a."messageId"=$2 AND m."workspaceId"=$1 LIMIT 1`, [getWorkspaceId(), id]);
  const attachment = result.rows[0];
  if (!attachment) return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  if (!(await canAccessConversation(session, String(attachment.contactId), String(attachment.channelNumberId)))) return NextResponse.json({ error: "Attachment not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (String(attachment.malwareScanStatus) !== "CLEAN") return NextResponse.json({ error: "Attachment is unavailable until malware scanning confirms it is clean." }, { status: 409, headers: { "Cache-Control": "no-store" } });
  if (String(attachment.storageStatus) !== "STORED" || !attachment.encryptedContent) return NextResponse.json({ error: "Attachment is not available in CRM storage yet." }, { status: 409, headers: { "Retry-After": "60" } });
  try {
    const content = decryptMedia(attachment.encryptedContent as Uint8Array);
    const sha256 = mediaSha256(content);
    if (attachment.sha256 && String(attachment.sha256) !== sha256) return NextResponse.json({ error: "Stored attachment checksum validation failed." }, { status: 500 });
    const mimeType = String(attachment.mimeType).replace(/[^\w.+/-]/g, "") || "application/octet-stream";
    const filename = String(attachment.filename).replace(/[\\/\u0000-\u001f\u007f]/g, "_").slice(0, 255) || "attachment";
    const safeInline = new Set([
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "audio/aac", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/opus", "audio/amr",
      "video/mp4", "video/3gpp",
    ]).has(mimeType.toLowerCase());
    const disposition = safeInline ? "inline" : "attachment";
    const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
    const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || null;
    await getPostgresPool().query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","details","createdAt") VALUES ($1,$2,$3,'MESSAGE_ATTACHMENT_ACCESSED','MESSAGE',$4,$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), getWorkspaceId(), session.userId, id, sourceIp, JSON.stringify({ filename: String(attachment.filename).slice(0, 255), mimeType, sizeBytes: content.byteLength })]);
    return new Response(content, { status: 200, headers: {
      "Content-Type": mimeType,
      "Content-Length": String(content.byteLength),
      "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "no-referrer",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not read attachment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { session, needsMfa } = await requireMfaForAdminChange();
  if (!session) return NextResponse.json({ error: "Administrator sign-in required." }, { status: 401 });
  if (needsMfa) return NextResponse.json({ error: mfaAdminActionMessage("purging archived media") }, { status: 403 });
  if (!process.env.DATABASE_URL) return NextResponse.json({ error: "CRM attachment storage requires PostgreSQL." }, { status: 503 });
  const { id } = await context.params;
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = getWorkspaceId();
    const result = await client.query(`SELECT a."id",a."filename",a."storageStatus",a."sizeBytes" FROM "MessageAttachment" a JOIN "Message" m ON m."id"=a."messageId" WHERE a."workspaceId"=$1 AND a."messageId"=$2 AND m."workspaceId"=$1 FOR UPDATE OF a`, [workspaceId, id]);
    const attachment = result.rows[0];
    if (!attachment) { await client.query("ROLLBACK"); return NextResponse.json({ error: "Attachment not found." }, { status: 404 }); }
    if (String(attachment.storageStatus) === "DELETED") { await client.query("COMMIT"); return NextResponse.json({ deleted: true, alreadyDeleted: true }); }
    await client.query(`UPDATE "MessageAttachment" SET "encryptedContent"=NULL,"storageStatus"='DELETED',"errorSummary"=NULL,"nextAttemptAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [String(attachment.id)]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,'MESSAGE_ATTACHMENT_PURGED','MESSAGE',$4,$5::jsonb,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, JSON.stringify({ filename: String(attachment.filename), storageStatus: String(attachment.storageStatus), sizeBytes: Number(attachment.sizeBytes) }), JSON.stringify({ storageStatus: "DELETED", encryptedContentRemoved: true })]);
    await client.query("COMMIT");
    return NextResponse.json({ deleted: true });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not purge archived media." }, { status: 503 });
  } finally { client.release(); }
}
