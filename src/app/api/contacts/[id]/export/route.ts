import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { getSession } from "@/lib/auth";
import { getCrmSnapshot } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";
import { decryptMedia, mediaSha256 } from "@/lib/media-storage";
import type { QueryResultRow } from "pg";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sensitiveAuditKey = /password|secret|token|credential|rawpayload|messagebody|textbody/i;
const MAX_MEDIA_EXPORT_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_MANIFEST_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_EXPORT_FILES = 500;

type ZipEntry = { name: string; content: Buffer };
const crc32Table = Array.from({ length: 256 }, (_, value) => {
  let item = value;
  for (let bit = 0; bit < 8; bit++) item = (item >>> 1) ^ (item & 1 ? 0xedb88320 : 0);
  return item >>> 0;
});

function crc32(bytes: Buffer) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.content);
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14); central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.content.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36); central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

function safeAttachmentName(value: unknown) {
  return String(value || "attachment").replace(/[\\/\u0000-\u001f\u007f]/g, "_").replace(/^\.+$/, "attachment").slice(0, 180) || "attachment";
}

function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sensitiveAuditKey.test(key) ? "[hidden]" : redactAuditValue(nested)]));
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to export customer data." }, { status: 401 });
  if (session.role !== "Owner" && session.role !== "Admin") return NextResponse.json({ error: "Administrator access is required to export customer data." }, { status: 403 });
  const { id } = await context.params;
  const includeMedia = new URL(request.url).searchParams.get("includeMedia") === "1";
  let exported: Record<string, unknown>;
  let displayName = "customer";
  const archiveEntries: ZipEntry[] = [];
  let archiveBuffer: Buffer | null = null;
  let includedMediaCount = 0;
  let includedMediaBytes = 0;
  if (process.env.DATABASE_URL) {
    try {
      const pool = getPostgresPool();
      const workspaceId = getWorkspaceId();
      const [contactResult, identifiers, conversations, messages, notes, consents, changeHistory, attachmentFiles] = await Promise.all([
        pool.query<QueryResultRow>(`SELECT c."id",c."displayName",c."primaryPhone",c."email",c."source",c."ownerUserId",u."name" AS "ownerName",c."tags",c."customFields",c."suppressionState",c."suppressedAt",c."legalHoldAt",c."legalHoldReason",c."createdAt",c."updatedAt" FROM "Contact" c LEFT JOIN "User" u ON u."id"=c."ownerUserId" WHERE c."workspaceId"=$1 AND c."id"=$2`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT "type","normalizedValue","verified","source","createdAt" FROM "ContactIdentifier" WHERE "workspaceId"=$1 AND "contactId"=$2 ORDER BY "createdAt","id"`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT c."id",c."state",c."channelNumberId",n."label" AS "channelLabel",n."e164Number" AS "channelNumber",c."assignedUserId",u."name" AS "assignedTo",c."assignedTeamId",c."unreadCount",c."lastMessageAt",c."serviceWindowExpiresAt",c."createdAt",c."updatedAt" FROM "Conversation" c LEFT JOIN "ChannelNumber" n ON n."id"=c."channelNumberId" LEFT JOIN "User" u ON u."id"=c."assignedUserId" WHERE c."workspaceId"=$1 AND c."contactId"=$2 ORDER BY c."createdAt","id"`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT m."id",m."conversationId",m."channelNumberId",n."label" AS "channelLabel",n."e164Number" AS "channelNumber",m."direction",m."status",m."messageType",m."textBody",m."media",m."templateName",m."platformMessageId",m."idempotencyKey",m."failureClass",m."failureCode",m."sentAt",m."deliveredAt",m."readAt",m."receivedAt",m."createdAt",a."filename" AS "attachmentFilename",a."mimeType" AS "attachmentMimeType",a."sizeBytes" AS "attachmentSizeBytes",a."sha256" AS "attachmentSha256",a."storageStatus" AS "attachmentStorageStatus" FROM "Message" m LEFT JOIN "ChannelNumber" n ON n."id"=m."channelNumberId" LEFT JOIN "MessageAttachment" a ON a."messageId"=m."id" WHERE m."workspaceId"=$1 AND m."contactId"=$2 ORDER BY m."createdAt",m."id"`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT n."id",n."text",n."createdAt",u."name" AS "author" FROM "InternalNote" n LEFT JOIN "User" u ON u."id"=n."authorUserId" WHERE n."workspaceId"=$1 AND n."contactId"=$2 ORDER BY n."createdAt",n."id"`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT c."id",c."channel",c."scope",c."status",c."wordingVersion",c."evidenceSource",c."capturedAt",c."revokedAt",u."name" AS "capturedBy" FROM "ConsentRecord" c LEFT JOIN "User" u ON u."id"=c."capturedByUserId" WHERE c."workspaceId"=$1 AND c."contactId"=$2 ORDER BY c."capturedAt",c."id"`, [workspaceId,id]),
        pool.query<QueryResultRow>(`SELECT e."id",e."action",e."targetType",e."targetId",e."sourceIp",e."userAgent",e."before",e."after",e."details",e."createdAt",u."name" AS "actorName",u."email" AS "actorEmail" FROM "AuditEvent" e LEFT JOIN "User" u ON u."id"=e."actorUserId" WHERE e."workspaceId"=$1 AND ((e."targetType"='CONTACT' AND e."targetId"=$2) OR (e."targetType"='MESSAGE' AND e."targetId" IN (SELECT m."id" FROM "Message" m WHERE m."workspaceId"=$1 AND m."contactId"=$2)) OR (e."targetType"='FAILOVER_EVENT' AND e."targetId" IN (SELECT f."id" FROM "FailoverEvent" f JOIN "Conversation" c ON c."id"=f."conversationId" AND c."workspaceId"=f."workspaceId" WHERE f."workspaceId"=$1 AND c."contactId"=$2))) ORDER BY e."createdAt","id"`, [workspaceId,id]),
        includeMedia ? pool.query<QueryResultRow>(`SELECT m."id" AS "messageId",a."id" AS "attachmentId",a."filename",a."mimeType",a."sizeBytes",a."sha256",a."storageStatus",a."malwareScanStatus" FROM "Message" m JOIN "MessageAttachment" a ON a."messageId"=m."id" WHERE m."workspaceId"=$1 AND m."contactId"=$2 ORDER BY m."createdAt",m."id" LIMIT $3`, [workspaceId,id,MAX_MEDIA_EXPORT_FILES + 1]) : Promise.resolve({ rows: [] as QueryResultRow[] }),
      ]);
      const contact = contactResult.rows[0];
      if (!contact) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
      displayName = String(contact.displayName || contact.primaryPhone);
      const attachmentPaths = new Map<string, string>();
      const mediaStatus = new Map<string, string>();
      if (includeMedia) {
        if (attachmentFiles.rows.length > MAX_MEDIA_EXPORT_FILES) return NextResponse.json({ error: `This customer has more than ${MAX_MEDIA_EXPORT_FILES} attachments. Export metadata and download smaller groups from the inbox.` }, { status: 413 });
        const eligibleFiles = attachmentFiles.rows.filter((file) => String(file.storageStatus) === "STORED" && String(file.malwareScanStatus) === "CLEAN");
        const declaredBytes = eligibleFiles.reduce((total, file) => total + Number(file.sizeBytes), 0);
        if (!Number.isFinite(declaredBytes) || declaredBytes > MAX_MEDIA_EXPORT_BYTES) return NextResponse.json({ error: `Stored attachments exceed the ${MAX_MEDIA_EXPORT_BYTES / (1024 * 1024)} MB archive limit. Export metadata and download smaller groups from the inbox.` }, { status: 413 });
        for (const file of attachmentFiles.rows) {
          const messageId = String(file.messageId);
          if (String(file.storageStatus) !== "STORED" || String(file.malwareScanStatus) !== "CLEAN") {
            mediaStatus.set(messageId, `Not included (${String(file.storageStatus).toLowerCase()}; scan ${String(file.malwareScanStatus).toLowerCase()})`);
            continue;
          }
          const stored = await pool.query<QueryResultRow>(`SELECT "encryptedContent" FROM "MessageAttachment" WHERE "id"=$1 AND "workspaceId"=$2 AND "storageStatus"='STORED' AND "malwareScanStatus"='CLEAN'`, [String(file.attachmentId),workspaceId]);
          const encryptedContent = stored.rows[0]?.encryptedContent;
          if (!encryptedContent) { mediaStatus.set(messageId, "Not included (file changed or became unavailable during export)"); continue; }
          const content = decryptMedia(encryptedContent as Uint8Array);
          const digest = mediaSha256(content);
          if (file.sha256 && String(file.sha256) !== digest) throw new Error(`Attachment checksum validation failed for message ${messageId}.`);
          if (includedMediaBytes + content.byteLength > MAX_MEDIA_EXPORT_BYTES) return NextResponse.json({ error: `Stored attachments exceed the ${MAX_MEDIA_EXPORT_BYTES / (1024 * 1024)} MB archive limit. Export metadata and download smaller groups from the inbox.` }, { status: 413 });
          const archivePath = `attachments/${messageId}-${safeAttachmentName(file.filename)}`;
          archiveEntries.push({ name: archivePath, content });
          attachmentPaths.set(messageId, archivePath);
          mediaStatus.set(messageId, "Included");
          includedMediaCount++;
          includedMediaBytes += content.byteLength;
        }
      }
      const exportedMessages = messages.rows.map((message) => ({
        ...message,
        ...(includeMedia ? { attachmentArchivePath: attachmentPaths.get(String(message.id)) ?? null, attachmentExportStatus: mediaStatus.get(String(message.id)) ?? (message.attachmentFilename ? "Not included" : null) } : {}),
      }));
      exported = {
        exportVersion: 3,
        exportedAt: new Date().toISOString(),
        customer: { ...contact, identifiers: identifiers.rows },
        consentRecords: consents.rows,
        conversations: conversations.rows,
        messages: exportedMessages,
        internalNotes: notes.rows,
        changeHistory: changeHistory.rows.map((event) => ({ ...event, before: redactAuditValue(event.before), after: redactAuditValue(event.after), details: redactAuditValue(event.details) })),
        attachmentContentsIncluded: includedMediaCount > 0,
        attachmentContentsNote: includeMedia ? "Clean archived attachments are included under attachments/. Files that were not stored or did not pass malware scanning are identified in each message entry." : "Archived attachment bytes are excluded; metadata and storage state are included. Use Export with files to include available clean attachments.",
      };
      const forwarded = request.headers.get("x-forwarded-for")?.split(",").map((item) => item.trim()).filter(Boolean);
      const sourceIp = request.headers.get("x-real-ip")?.trim() || forwarded?.at(-1) || null;
      if (includeMedia) {
        const manifest = Buffer.from(JSON.stringify(exported, null, 2), "utf8");
        if (manifest.byteLength > MAX_ARCHIVE_MANIFEST_BYTES) return NextResponse.json({ error: `The customer history exceeds the ${MAX_ARCHIVE_MANIFEST_BYTES / (1024 * 1024)} MB archive manifest limit. Download the standard JSON export instead.` }, { status: 413 });
        archiveEntries.push({ name: "customer-export.json", content: manifest });
        archiveBuffer = createZip(archiveEntries);
      }
      await pool.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","sourceIp","details","createdAt") VALUES ($1,$2,$3,'CONTACT_DATA_EXPORTED','CONTACT',$4,$5,$6::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, session.userId, id, sourceIp, JSON.stringify({ format: includeMedia ? "zip_with_media" : "json", conversationCount: conversations.rows.length, messageCount: messages.rows.length, attachmentMetadataCount: messages.rows.filter((row) => row.attachmentFilename).length, includedMediaCount, includedMediaBytes })]);
    } catch { return NextResponse.json({ error: "The export could not be prepared and audited, so it was not created." }, { status: 503 }); }
  } else {
    const snapshot = await getCrmSnapshot();
    const contact = snapshot.chats.find((chat) => chat.id === id);
    if (!contact) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
    displayName = contact.name;
    exported = {
      exportVersion: 2,
      exportedAt: new Date().toISOString(),
      customer: { id: contact.id, name: contact.name, phone: contact.phone, messagingConsent: contact.messagingConsent, consentHistory: contact.consentHistory ?? [], label: contact.label, tags: contact.tags ?? [], state: contact.state, assignedTo: contact.assignedTo ?? null },
      conversationHistory: contact.messages,
      internalNotes: contact.internalNotes ?? [],
      changeHistory: [],
      changeHistoryNote: "Administrative change history is available in PostgreSQL mode only.",
      attachmentContentsIncluded: false,
      attachmentContentsNote: includeMedia ? "Media file export is available only when PostgreSQL attachment storage is configured." : "Attachment bytes are not available in local JSON mode.",
    };
  }
  const safeName = displayName.normalize("NFKD").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "customer";
  if (includeMedia && process.env.DATABASE_URL) {
    if (!archiveBuffer) return NextResponse.json({ error: "Could not package the customer export." }, { status: 500 });
      return new Response(archiveBuffer as unknown as BodyInit, { headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}-crm-export.zip"`,
        "Cache-Control": "no-store, private",
        "X-Content-Type-Options": "nosniff",
      } });
  }
  return new NextResponse(JSON.stringify(exported, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeName}-crm-export.json"`,
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
