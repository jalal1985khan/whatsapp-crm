import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient, QueryResultRow } from "pg";
import type { ChannelNumber, MessagingConsent, Store, StoredChat } from "@/lib/crm-store";
import { demoSeedChatIds, demoSeedNumberIds } from "@/lib/crm-store";
import { ensureWorkspace, getPostgresPool } from "@/lib/postgres-pool";

type Row = QueryResultRow;
const colors = ["bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700", "bg-indigo-100 text-indigo-700"];

function string(value: unknown) { return value == null ? "" : String(value); }
function nullableString(value: unknown) { return value == null ? undefined : String(value); }
function date(value: unknown) { return value instanceof Date ? value : new Date(string(value)); }
function timeLabel(value: unknown) {
  const timestamp = date(value);
  return timestamp.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}
function stateFromDb(value: unknown): ChannelNumber["state"] {
  switch (value) {
    case "ACTIVE": return "Active";
    case "PENDING": return "Pending approval";
    case "DEGRADED": return "Degraded";
    case "RESTRICTED": return "Restricted";
    case "DISCONNECTED": return "Disconnected";
    case "ARCHIVED": return "Archived";
    default: return "Paused";
  }
}
function stateToDb(value: ChannelNumber["state"]) {
  switch (value) {
    case "Active": return "ACTIVE";
    case "Pending approval": return "PENDING";
    case "Degraded": return "DEGRADED";
    case "Restricted": return "RESTRICTED";
    case "Disconnected": return "DISCONNECTED";
    case "Archived": return "ARCHIVED";
    default: return "PAUSED";
  }
}
function roleFromDb(value: unknown): Store["users"][number]["role"] {
  switch (value) {
    case "OWNER": return "Owner";
    case "ADMIN": return "Admin";
    case "SUPERVISOR": return "Supervisor";
    default: return "Agent";
  }
}
function roleToDb(value: Store["users"][number]["role"]) { return value.toUpperCase(); }
function consentFromDb(value: unknown): Exclude<MessagingConsent, "unknown"> {
  return value === "OPTED_OUT" ? "opted_out" : "opted_in";
}

async function loadStore(client: PoolClient, workspaceId: string, contactIds?: string[]): Promise<Store> {
  const contactFilter = contactIds === undefined ? "" : ` AND c."id"=ANY($2::text[])`;
  const contactIdFilter = contactIds === undefined ? "" : ` AND "contactId"=ANY($2::text[])`;
  const contactParams: unknown[] = contactIds === undefined ? [workspaceId] : [workspaceId, contactIds];
  const userResult = await client.query<Row>(`SELECT u."id", u."email", u."passwordHash", u."name", u."active", wu."role"
      FROM "WorkspaceUser" wu JOIN "User" u ON u."id" = wu."userId"
      WHERE wu."workspaceId" = $1 ORDER BY u."createdAt"`, [workspaceId]);
  const numberResult = await client.query<Row>(`SELECT n."id", n."label", n."e164Number", n."displayName", n."metaPhoneNumberId", n."metaWabaId", n."approvedByUserId", n."qualitySignal", n."allowedTeamIds", n."assignedUserId", u."name" AS "assignedUserName", n."routingPriority", n."lastStatusEventAt", n."state", n."createdAt", n."whatsappConnectionId", n."provider", n."twilioAccountId", n."twilioAccountSid", ta."friendlyName" AS "twilioAccountName", ta."accountSid" AS "taAccountSid", wc."status" AS "metaConnectionStatus", wc."tokenExpiresAt" AS "metaTokenExpiresAt"
      FROM "ChannelNumber" n
      LEFT JOIN "User" u ON u."id"=n."assignedUserId"
      LEFT JOIN "WhatsAppConnection" wc ON wc."id"=n."whatsappConnectionId" AND wc."workspaceId"=n."workspaceId"
      LEFT JOIN "TwilioAccount" ta ON ta."id"=n."twilioAccountId" AND ta."workspaceId"=n."workspaceId"
      WHERE n."workspaceId" = $1 ORDER BY n."routingPriority", n."createdAt"`, [workspaceId]);
  const contactResult = await client.query<Row>(`SELECT c."id",c."displayName",c."primaryPhone",c."email",c."source",c."ownerUserId",owner."name" AS "ownerName",c."customFields",c."tags",c."createdAt",c."updatedAt",c."legalHoldAt",c."legalHoldReason" FROM "Contact" c LEFT JOIN "User" owner ON owner."id"=c."ownerUserId"
      WHERE c."workspaceId" = $1 AND c."mergedIntoContactId" IS NULL${contactFilter} ORDER BY COALESCE((SELECT MAX(conv."lastMessageAt") FROM "Conversation" conv WHERE conv."contactId" = c."id"), c."createdAt") DESC`, contactParams);
  const phoneIdentifierResult = await client.query<Row>(`SELECT "contactId","normalizedValue" FROM "ContactIdentifier" WHERE "workspaceId"=$1 AND "type"='PHONE'${contactIdFilter} ORDER BY "createdAt","id"`, contactParams);
  const conversationResult = await client.query<Row>(`SELECT c."id", c."contactId", c."channelNumberId", c."state", c."unreadCount", c."lastMessageAt", c."serviceWindowExpiresAt", c."updatedAt", c."assignedUserId", u."name" AS "assignedTo",c."assignedTeamId",t."name" AS "assignedTeam"
      FROM "Conversation" c LEFT JOIN "User" u ON u."id" = c."assignedUserId" LEFT JOIN "Team" t ON t."id"=c."assignedTeamId"
      WHERE c."workspaceId" = $1${contactIds === undefined ? "" : ` AND c."contactId"=ANY($2::text[])`} ORDER BY c."lastMessageAt" DESC, c."updatedAt" DESC`, contactParams);
  const messageResult = await client.query<Row>(`SELECT m."id",m."contactId",m."channelNumberId",m."direction",m."status",m."failureClass",m."messageType",m."textBody",m."media",m."createdAt",a."storageStatus" AS "attachmentStorageStatus",a."sizeBytes" AS "attachmentSizeBytes"
      FROM "Message" m LEFT JOIN "MessageAttachment" a ON a."messageId"=m."id" WHERE m."workspaceId"=$1 AND m."direction"<>'INTERNAL'${contactIds === undefined ? "" : ` AND m."contactId"=ANY($2::text[])`} ORDER BY m."createdAt",m."id"`, contactParams);
  const noteResult = await client.query<Row>(`SELECT n."id", n."contactId", n."text", n."createdAt", u."name" AS "author"
      FROM "InternalNote" n LEFT JOIN "User" u ON u."id" = n."authorUserId"
      WHERE n."workspaceId" = $1${contactIds === undefined ? "" : ` AND n."contactId"=ANY($2::text[])`} ORDER BY n."createdAt", n."id"`, contactParams);
  const consentResult = await client.query<Row>(`SELECT c."id", c."contactId", c."status", c."evidenceSource", c."wordingVersion", c."capturedAt", u."name" AS "updatedBy"
      FROM "ConsentRecord" c LEFT JOIN "User" u ON u."id" = c."capturedByUserId"
      WHERE c."workspaceId" = $1 AND c."channel" = 'WHATSAPP' AND c."scope" = 'WHATSAPP_MESSAGING'${contactIds === undefined ? "" : ` AND c."contactId"=ANY($2::text[])`}
      ORDER BY c."capturedAt", c."id"`, contactParams);

  const numbers: ChannelNumber[] = numberResult.rows.map((row) => {
    const expiresAt = row.metaTokenExpiresAt == null ? null : date(row.metaTokenExpiresAt);
    const now = Date.now();
    const connectionStatus: ChannelNumber["metaConnectionStatus"] = row.whatsappConnectionId == null
      ? process.env.META_ACCESS_TOKEN ? "SERVER_TOKEN" : "UNLINKED"
      : row.metaConnectionStatus == null ? "CONNECTION_MISSING"
      : String(row.metaConnectionStatus) !== "ACTIVE" ? "INACTIVE"
      : expiresAt && expiresAt.getTime() <= now ? "EXPIRED"
      : expiresAt && expiresAt.getTime() <= now + 7 * 24 * 60 * 60 * 1000 ? "EXPIRING"
      : "CONNECTED";
    const isTwilioNumber = (row.provider as string) === "TWILIO" || Boolean(row.twilioAccountId || row.twilioAccountSid);
    const isApproved = Boolean(row.approvedByUserId || row.approvedAt || isTwilioNumber);
    return {
      id: string(row.id), label: string(row.label), number: string(row.e164Number), displayName: nullableString(row.displayName),
      provider: (row.provider as "TWILIO" | "META") || (row.metaPhoneNumberId ? "META" : "TWILIO"),
      twilioAccountId: nullableString(row.twilioAccountId),
      twilioAccountSid: nullableString(row.twilioAccountSid || row.taAccountSid),
      twilioAccountName: nullableString(row.twilioAccountName),
      metaPhoneNumberId: nullableString(row.metaPhoneNumberId), metaWabaId: nullableString(row.metaWabaId), qualitySignal: nullableString(row.qualitySignal), allowedTeamIds: Array.isArray(row.allowedTeamIds) ? row.allowedTeamIds.map(String) : [], assignedUserId: nullableString(row.assignedUserId), assignedUserName: nullableString(row.assignedUserName), routingPriority: Number(row.routingPriority), lastStatusEventAt: row.lastStatusEventAt == null ? undefined : date(row.lastStatusEventAt).toISOString(), metaConnectionStatus: connectionStatus, metaTokenExpiresAt: expiresAt?.toISOString() ?? null, state: String(row.state) === "ACTIVE" && !isApproved ? "Pending approval" : stateFromDb(row.state), createdAt: date(row.createdAt).toISOString(),
    };
  });
  const conversationsByContact = new Map<string, Row[]>();
  for (const conversation of conversationResult.rows) {
    const key = string(conversation.contactId);
    conversationsByContact.set(key, [...(conversationsByContact.get(key) ?? []), conversation]);
  }
  const messagesByContact = new Map<string, Row[]>();
  for (const message of messageResult.rows) {
    const key = string(message.contactId);
    messagesByContact.set(key, [...(messagesByContact.get(key) ?? []), message]);
  }
  const notesByContact = new Map<string, Row[]>();
  for (const note of noteResult.rows) {
    const key = string(note.contactId);
    notesByContact.set(key, [...(notesByContact.get(key) ?? []), note]);
  }
  const consentByContact = new Map<string, Row[]>();
  for (const consent of consentResult.rows) {
    const key = string(consent.contactId);
    consentByContact.set(key, [...(consentByContact.get(key) ?? []), consent]);
  }
  const phoneIdentifiersByContact = new Map<string, string[]>();
  for (const identifier of phoneIdentifierResult.rows) {
    const contactId = string(identifier.contactId);
    phoneIdentifiersByContact.set(contactId, [...(phoneIdentifiersByContact.get(contactId) ?? []), string(identifier.normalizedValue)]);
  }

  const chats: StoredChat[] = contactResult.rows.map((contact, index) => {
    const id = string(contact.id);
    const messages = (messagesByContact.get(id) ?? []).map((message) => {
      const createdAt = date(message.createdAt).toISOString();
      let media: StoredChat["messages"][number]["media"];
      if (message.media && typeof message.media === "object") {
        const stored = message.media as Record<string, unknown>;
        const raw = stored[String(message.messageType)] && typeof stored[String(message.messageType)] === "object" ? stored[String(message.messageType)] as Record<string, unknown> : stored;
        media = { type: string(stored.type || message.messageType), mimeType: nullableString(stored.mimeType ?? raw.mime_type), filename: nullableString(stored.filename ?? raw.filename), size: Number.isFinite(Number(stored.size)) && Number(stored.size) > 0 ? Number(stored.size) : Number(message.attachmentSizeBytes) > 0 ? Number(message.attachmentSizeBytes) : undefined, caption: nullableString(stored.caption ?? raw.caption), mediaId: nullableString(stored.mediaId ?? raw.id), stored: message.attachmentStorageStatus === "STORED", storageStatus: nullableString(message.attachmentStorageStatus), messageId: string(message.id) };
      }
      return {
        id: string(message.id), text: string(message.textBody) || (media ? `[${media.type} attachment]` : ""), time: timeLabel(message.createdAt), createdAt, media,
        mine: message.direction === "OUTBOUND", senderNumberId: string(message.channelNumberId),
        status: ({ QUEUED: "queued", SENDING: "queued", SENT: "sent", DELIVERED: "delivered", READ: "read", FAILED: "failed", UNKNOWN: "unknown" } as Record<string, "queued" | "sent" | "delivered" | "read" | "failed" | "unknown">)[string(message.status)] ?? "queued",
        failureClass: nullableString(message.failureClass),
      };
    });
    const conversations = conversationsByContact.get(id) ?? [];
    const latest = conversations.reduce<Row | undefined>((candidate, conversation) => !candidate || date(conversation.updatedAt).getTime() > date(candidate.updatedAt).getTime() ? conversation : candidate, undefined);
    const tags = Array.isArray(contact.tags) ? contact.tags.map(string) : [];
    const consents = consentByContact.get(id) ?? [];
    const consentHistory = consents.map((record) => ({
      id: string(record.id), status: consentFromDb(record.status), source: string(record.evidenceSource), wordingVersion: string(record.wordingVersion) || undefined,
      updatedAt: date(record.capturedAt).toISOString(), updatedBy: string(record.updatedBy) || "Team member",
    }));
    const latestMessage = messages.at(-1);
    const createdAt = date(contact.createdAt);
    return {
      id, name: string(contact.displayName) || string(contact.primaryPhone), initials: (string(contact.displayName) || string(contact.primaryPhone)).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join(""),
      phone: string(contact.primaryPhone), additionalPhones: [...new Set((phoneIdentifiersByContact.get(id) ?? []).filter((phone) => phone !== string(contact.primaryPhone)))], email: nullableString(contact.email), source: nullableString(contact.source), ownerUserId: nullableString(contact.ownerUserId), ownerName: nullableString(contact.ownerName), customFields: contact.customFields && typeof contact.customFields === "object" && !Array.isArray(contact.customFields) ? contact.customFields as Record<string, unknown> : {}, createdAt: createdAt.toISOString(), updatedAt: date(contact.updatedAt).toISOString(), preview: latestMessage?.text || "No conversation yet", time: latestMessage?.time ?? createdAt.toLocaleDateString("en-IN"),
      unread: conversations.reduce((sum, conversation) => sum + Number(conversation.unreadCount ?? 0), 0) || undefined,
      state: latest?.state === "WAITING" ? "Waiting" : latest?.state === "RESOLVED" ? "Resolved" : "Open",
      assignedTo: nullableString(latest?.assignedTo), assignedUserId: nullableString(latest?.assignedUserId), assignedTeamId: nullableString(latest?.assignedTeamId), assignedTeam: nullableString(latest?.assignedTeam), conversationAssignments: conversations.map((conversation) => ({ channelNumberId: string(conversation.channelNumberId), assignedTeamId: nullableString(conversation.assignedTeamId), assignedUserId: nullableString(conversation.assignedUserId), state: conversation.state === "WAITING" ? "Waiting" : conversation.state === "RESOLVED" ? "Resolved" : "Open", unreadCount: Number(conversation.unreadCount ?? 0), serviceWindowExpiresAt: conversation.serviceWindowExpiresAt == null ? null : date(conversation.serviceWindowExpiresAt).toISOString() })), channelNumberIds: [...new Set(conversations.map((conversation) => string(conversation.channelNumberId)))], currentSenderNumberId: nullableString(latest?.channelNumberId) ?? undefined, label: tags[0], tags, internalNotes: (notesByContact.get(id) ?? []).map((note) => ({
        id: string(note.id), text: string(note.text), author: string(note.author) || "Team member", time: timeLabel(note.createdAt), createdAt: date(note.createdAt).toISOString(),
      })),
      messagingConsent: consentHistory.at(-1)?.status ?? "unknown", consentSource: consentHistory.at(-1)?.source,
      consentUpdatedAt: consentHistory.at(-1)?.updatedAt, consentUpdatedBy: consentHistory.at(-1)?.updatedBy, consentHistory,
      legalHoldAt: contact.legalHoldAt ? date(contact.legalHoldAt).toISOString() : null, legalHoldReason: nullableString(contact.legalHoldReason),
      color: colors[index % colors.length], messages,
    };
  });

  return {
    numbers,
    chats,
    users: userResult.rows.map((row) => ({ id: string(row.id), email: string(row.email), passwordHash: string(row.passwordHash), name: string(row.name), role: roleFromDb(row.role), active: Boolean(row.active) })),
  } satisfies Store;
}

async function saveStore(client: PoolClient, workspaceId: string, store: Store, previous?: Store) {
  const actualUserIdByStoreId = new Map<string, string>();
  const userIdByName = new Map<string, string>();
  const previousUsers = new Map(previous?.users.map((user) => [user.id, user]) ?? []);
  for (const user of store.users) {
    const oldUser = previousUsers.get(user.id);
    let actualId = user.id;
    if (!oldUser || JSON.stringify(oldUser) !== JSON.stringify(user)) {
      const saved = await client.query<Row>(`INSERT INTO "User" ("id", "email", "name", "passwordHash", "active", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP)
        ON CONFLICT ("email") DO UPDATE SET "name" = EXCLUDED."name", "passwordHash" = EXCLUDED."passwordHash", "active" = EXCLUDED."active", "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id"`, [user.id, user.email.toLowerCase(), user.name, user.passwordHash, user.active]);
      actualId = string(saved.rows[0].id);
    }
    actualUserIdByStoreId.set(user.id, actualId);
    userIdByName.set(user.name, actualId);
    if (!oldUser || oldUser.role !== user.role) {
      await client.query(`INSERT INTO "WorkspaceUser" ("workspaceId", "userId", "role") VALUES ($1,$2,$3::"WorkspaceRole")
        ON CONFLICT ("workspaceId", "userId") DO UPDATE SET "role" = EXCLUDED."role"`, [workspaceId, actualId, roleToDb(user.role)]);
    }
  }

  const numberIds = new Set(store.numbers.map((number) => number.id));
  const previousNumbers = new Map(previous?.numbers.map((number) => [number.id, number]) ?? []);
  for (const number of store.numbers) {
    const oldNumber = previousNumbers.get(number.id);
    if (oldNumber && JSON.stringify(oldNumber) === JSON.stringify(number)) continue;
    await client.query(`INSERT INTO "ChannelNumber" ("id", "workspaceId", "label", "e164Number", "metaPhoneNumberId", "metaWabaId", "qualitySignal", "allowedTeamIds", "assignedUserId", "routingPriority", "state", "createdAt", "updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::"NumberState",$12,CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO UPDATE SET "label" = EXCLUDED."label", "e164Number" = EXCLUDED."e164Number", "metaPhoneNumberId" = EXCLUDED."metaPhoneNumberId", "metaWabaId" = EXCLUDED."metaWabaId", "qualitySignal" = EXCLUDED."qualitySignal", "allowedTeamIds" = EXCLUDED."allowedTeamIds", "assignedUserId" = EXCLUDED."assignedUserId", "routingPriority" = EXCLUDED."routingPriority", "state" = EXCLUDED."state", "updatedAt" = CURRENT_TIMESTAMP`,
    [number.id, workspaceId, number.label, number.number.replace(/[\s()-]/g, ""), number.metaPhoneNumberId ?? null, number.metaWabaId ?? null, number.qualitySignal ?? null, number.allowedTeamIds ?? [], number.assignedUserId ?? null, number.routingPriority ?? (store.numbers.indexOf(number) + 1) * 100, stateToDb(number.state), date(number.createdAt)]);
  }

  const previousChats = new Map(previous?.chats.map((chat) => [chat.id, chat]) ?? []);
  for (const chat of store.chats) {
    const previousChat = previousChats.get(chat.id);
    const tags = chat.tags ?? (chat.label ? [chat.label] : []);
    const previousTags = previousChat?.tags ?? (previousChat?.label ? [previousChat.label] : []);
    if (!previousChat || chat.name !== previousChat.name || chat.phone !== previousChat.phone || chat.email !== previousChat.email || chat.source !== previousChat.source || chat.ownerUserId !== previousChat.ownerUserId || JSON.stringify(chat.customFields ?? {}) !== JSON.stringify(previousChat.customFields ?? {}) || JSON.stringify(tags) !== JSON.stringify(previousTags)) {
      const ownerId = chat.ownerUserId ? actualUserIdByStoreId.get(chat.ownerUserId) ?? null : null;
      await client.query(`INSERT INTO "Contact" ("id", "workspaceId", "displayName", "primaryPhone", "email", "source", "ownerUserId", "tags", "customFields", "updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT ("id") DO UPDATE SET "displayName" = EXCLUDED."displayName", "primaryPhone" = EXCLUDED."primaryPhone", "email" = EXCLUDED."email", "source" = EXCLUDED."source", "ownerUserId" = EXCLUDED."ownerUserId", "tags" = EXCLUDED."tags", "customFields" = EXCLUDED."customFields", "updatedAt" = CURRENT_TIMESTAMP`,
      [chat.id, workspaceId, chat.name, chat.phone, chat.email ?? null, chat.source ?? null, ownerId, tags, JSON.stringify(chat.customFields ?? {})]);
    }

    const messagesByNumber = new Map<string, typeof chat.messages>();
    for (const message of chat.messages) {
      if (!numberIds.has(message.senderNumberId)) throw new Error(`Message ${message.id} refers to a sender number that is missing from the workspace.`);
      messagesByNumber.set(message.senderNumberId, [...(messagesByNumber.get(message.senderNumberId) ?? []), message]);
    }
    const orderedGroups = [...messagesByNumber.entries()];
    for (const [groupIndex, [numberId, messages]] of orderedGroups.entries()) {
      const priorGroup = previousChat?.messages.filter((message) => message.senderNumberId === numberId) ?? [];
      const priorMessages = new Map(priorGroup.map((message) => [message.id, message]));
      const newMessages = messages.filter((message) => !priorMessages.has(message.id) || JSON.stringify(priorMessages.get(message.id)) !== JSON.stringify(message));
      const previousGroupIndex = previousChat ? [...new Set(previousChat.messages.map((message) => message.senderNumberId))].indexOf(numberId) : -1;
      const groupStateChanged = !previousChat || previousChat.state !== chat.state || previousChat.assignedTo !== chat.assignedTo ||
        ((previousGroupIndex === 0 ? previousChat.unread ?? 0 : 0) !== (groupIndex === 0 ? chat.unread ?? 0 : 0));
      if (newMessages.length === 0 && !groupStateChanged) continue;
      const conversationId = `crm-conv-${chat.id}-${numberId}`;
      const lastMessage = messages.at(-1);
      const latestInbound = [...messages].reverse().find((message) => !message.mine && message.createdAt);
      const serviceWindowExpiresAt = latestInbound?.createdAt ? new Date(new Date(latestInbound.createdAt).getTime() + 24 * 60 * 60 * 1000) : null;
      const conversation = await client.query<Row>(`INSERT INTO "Conversation" ("id", "workspaceId", "contactId", "channelNumberId", "state", "assignedUserId", "unreadCount", "lastMessageAt", "serviceWindowExpiresAt", "updatedAt")
        VALUES ($1,$2,$3,$4,$5::"ConversationState",$6,$7,$8,$9,CURRENT_TIMESTAMP)
        ON CONFLICT ("contactId", "channelNumberId") DO UPDATE SET "state" = EXCLUDED."state", "assignedUserId" = EXCLUDED."assignedUserId", "unreadCount" = EXCLUDED."unreadCount", "lastMessageAt" = EXCLUDED."lastMessageAt", "serviceWindowExpiresAt" = COALESCE(EXCLUDED."serviceWindowExpiresAt", "Conversation"."serviceWindowExpiresAt"), "updatedAt" = CURRENT_TIMESTAMP
        RETURNING "id"`, [conversationId, workspaceId, chat.id, numberId, chat.state === "Resolved" ? "RESOLVED" : chat.state === "Waiting" ? "WAITING" : "OPEN", chat.assignedTo ? userIdByName.get(chat.assignedTo) ?? null : null, groupIndex === 0 ? chat.unread ?? 0 : 0, lastMessage?.createdAt ? date(lastMessage.createdAt) : new Date(), serviceWindowExpiresAt]);
      const conversationIdSaved = string(conversation.rows[0].id);
      for (const message of newMessages) {
        const messageIndex = messages.findIndex((item) => item.id === message.id);
        message.createdAt ??= new Date(Date.now() - (messages.length - messageIndex) * 1000).toISOString();
        await client.query(`INSERT INTO "Message" ("id", "workspaceId", "conversationId", "contactId", "channelNumberId", "direction", "status", "textBody", "createdAt")
          VALUES ($1,$2,$3,$4,$5,$6::"MessageDirection",$7::"MessageStatus",$8,$9)
          ON CONFLICT ("id") DO UPDATE SET "conversationId" = EXCLUDED."conversationId", "channelNumberId" = EXCLUDED."channelNumberId", "direction" = EXCLUDED."direction", "status" = EXCLUDED."status", "textBody" = EXCLUDED."textBody"`,
        [message.id, workspaceId, conversationIdSaved, chat.id, numberId, message.mine ? "OUTBOUND" : "INBOUND", message.status === "local" ? "SENT" : message.status.toUpperCase(), message.text, date(message.createdAt)]);
      }
    }

    const previousNoteIds = new Set(previousChat?.internalNotes?.map((note) => note.id) ?? []);
    for (const note of chat.internalNotes ?? []) {
      if (previousNoteIds.has(note.id)) continue;
      await client.query(`INSERT INTO "InternalNote" ("id", "workspaceId", "contactId", "authorUserId", "text", "createdAt")
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT ("id") DO NOTHING`,
      [note.id, workspaceId, chat.id, userIdByName.get(note.author) ?? null, note.text, date(note.createdAt)]);
    }
    const previousConsentIds = new Set(previousChat?.consentHistory?.map((consent) => consent.id) ?? []);
    for (const consent of chat.consentHistory ?? []) {
      if (previousConsentIds.has(consent.id)) continue;
      const actorId = userIdByName.get(consent.updatedBy) ?? actualUserIdByStoreId.get(consent.updatedBy) ?? null;
      await client.query(`INSERT INTO "ConsentRecord" ("id", "workspaceId", "contactId", "channel", "scope", "status", "evidenceSource", "wordingVersion", "capturedAt", "capturedByUserId", "revokedAt")
        VALUES ($1,$2,$3,'WHATSAPP','WHATSAPP_MESSAGING',$4::"ConsentStatus",$5,$6,$7,$8,$9) ON CONFLICT ("id") DO NOTHING`,
      [consent.id, workspaceId, chat.id, consent.status === "opted_out" ? "OPTED_OUT" : "OPTED_IN", consent.source, consent.wordingVersion ?? null, date(consent.updatedAt), actorId, consent.status === "opted_out" ? date(consent.updatedAt) : null]);
      await client.query(`UPDATE "Contact" SET "suppressionState"=$3,"suppressedAt"=CASE WHEN $3='OPTED_OUT' THEN $4 ELSE NULL END WHERE "workspaceId"=$1 AND "id"=$2`, [workspaceId, chat.id, consent.status === "opted_out" ? "OPTED_OUT" : "OPTED_IN", date(consent.updatedAt)]);
    }
  }
}

async function importLocalStoreOnce(client: PoolClient, workspaceId: string) {
  const importResult = await client.query<Row>(`SELECT "id" FROM "LocalDataImport" WHERE "workspaceId" = $1`, [workspaceId]);
  if (importResult.rows.length) return;

  const countResult = await client.query<Row>(`SELECT
      (SELECT COUNT(*) FROM "WorkspaceUser" WHERE "workspaceId" = $1) AS "users",
      (SELECT COUNT(*) FROM "ChannelNumber" WHERE "workspaceId" = $1) AS "numbers",
      (SELECT COUNT(*) FROM "Contact" WHERE "workspaceId" = $1) AS "contacts"`, [workspaceId]);
  const databaseHasData = Object.values(countResult.rows[0] ?? {}).some((value) => Number(value) > 0);
  let sourceHash: string | null = null;
  let rowCounts: Record<string, number | boolean | string> = { skipped: databaseHasData };

  if (!databaseHasData && process.env.CRM_IMPORT_LOCAL_DATA === "true") {
    const localPath = process.env.CRM_STORE_PATH || path.join(process.cwd(), "data", "crm-store.json");
    let contents: string | undefined;
    try { contents = await readFile(localPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if (contents) {
      let localStore: Store;
      try { localStore = JSON.parse(contents) as Store; }
      catch { throw new Error("The existing local CRM file is not valid JSON. Fix or back it up before enabling PostgreSQL so its customer history can be preserved."); }
      if (!localStore || !Array.isArray(localStore.chats) || !Array.isArray(localStore.numbers) || (localStore.users !== undefined && !Array.isArray(localStore.users))) {
        throw new Error("The existing local CRM file has an incomplete structure. It was not imported so customer history remains untouched.");
      }
      localStore.users ??= [];
      const demoContactsSkipped = localStore.chats.filter((chat) => demoSeedChatIds.has(chat.id)).length;
      localStore.chats = localStore.chats.filter((chat) => !demoSeedChatIds.has(chat.id));
      // Demo numbers still referenced by real local conversations are kept for history but paused so they need fresh approval.
      const referencedNumberIds = new Set(localStore.chats.flatMap((chat) => [
        ...chat.messages.map((message) => message.senderNumberId),
        ...(chat.channelNumberIds ?? []),
        ...(chat.eligibleSenderNumberIds ?? []),
        ...(chat.conversationAssignments ?? []).map((assignment) => assignment.channelNumberId),
        ...(chat.currentSenderNumberId ? [chat.currentSenderNumberId] : []),
      ]));
      const demoNumbersSkipped = localStore.numbers.filter((number) => demoSeedNumberIds.has(number.id) && !referencedNumberIds.has(number.id)).length;
      localStore.numbers = localStore.numbers
        .filter((number) => !demoSeedNumberIds.has(number.id) || referencedNumberIds.has(number.id))
        .map((number) => demoSeedNumberIds.has(number.id) ? { ...number, state: "Paused" as const } : number);
      localStore.chats = localStore.chats.map((chat) => {
        const history = chat.consentHistory ?? [];
        if (history.length || !chat.messagingConsent || chat.messagingConsent === "unknown") return { ...chat, consentHistory: history };
        const status = chat.messagingConsent;
        const updatedAt = chat.consentUpdatedAt ?? new Date().toISOString();
        return {
          ...chat,
          consentHistory: [{
            id: `legacy-consent-${chat.id}`,
            status,
            source: chat.consentSource ?? "Legacy CRM record (source not recorded)",
            updatedAt,
            updatedBy: chat.consentUpdatedBy ?? "Legacy CRM record",
          }],
        };
      });
      await saveStore(client, workspaceId, localStore);
      sourceHash = createHash("sha256").update(contents).digest("hex");
      rowCounts = { users: localStore.users.length, numbers: localStore.numbers.length, contacts: localStore.chats.length, demoContactsSkipped, demoNumbersSkipped };
    } else {
      rowCounts = { sourceFileMissing: true };
    }
  } else if (!databaseHasData) {
    rowCounts = { skipped: true, reason: "CRM_IMPORT_LOCAL_DATA not set to true" };
  }

  await client.query(`INSERT INTO "LocalDataImport" ("id", "workspaceId", "sourceHash", "rowCounts") VALUES ($1,$2,$3,$4::jsonb)`,
    [`local-import-${workspaceId}`, workspaceId, sourceHash, JSON.stringify(rowCounts)]);
}

export async function readPostgresStore(contactIds?: string[]) {
  const client = await getPostgresPool().connect();
  let inTransaction = false;
  try {
    const workspaceId = await ensureWorkspace(client);
    const imported = await client.query<Row>(`SELECT "id" FROM "LocalDataImport" WHERE "workspaceId" = $1`, [workspaceId]);
    if (imported.rows.length) return await loadStore(client, workspaceId, contactIds);
    await client.query("BEGIN");
    inTransaction = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`whatsapp-crm-store:${workspaceId}`]);
    await importLocalStoreOnce(client, workspaceId);
    const store = await loadStore(client, workspaceId, contactIds);
    await client.query("COMMIT");
    inTransaction = false;
    return store;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createPostgresContact(name: string, phone: string, ownerUserId?: string) {
  const normalized = phone.replace(/[\s()-]/g, "");
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Customer name is required.");
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error("Enter a phone number in international format, such as +14155550123.");
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    if (ownerUserId) {
      const owner = await client.query<Row>(`SELECT 1 FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND wu."userId"=$2 AND u."active"=TRUE`, [workspaceId, ownerUserId]);
      if (!owner.rows[0]) throw new Error("Choose an active owner in this workspace.");
    }
    const duplicate = await client.query<Row>(`SELECT c."id" FROM "Contact" c WHERE c."workspaceId"=$1 AND (c."primaryPhone"=$2 OR EXISTS (SELECT 1 FROM "ContactIdentifier" ci WHERE ci."workspaceId"=$1 AND ci."contactId"=c."id" AND ci."type"='PHONE' AND ci."normalizedValue"=$2)) FOR UPDATE`, [workspaceId, normalized]);
    if (duplicate.rows[0]) throw new Error("A customer with this phone number already exists.");
    const contactId = randomUUID();
    await client.query(`INSERT INTO "Contact" ("id","workspaceId","displayName","primaryPhone","ownerUserId","createdAt","updatedAt") VALUES ($1,$2,$3,$4,$5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [contactId, workspaceId, cleanName, normalized, ownerUserId ?? null]);
    await client.query(`INSERT INTO "ContactIdentifier" ("id","workspaceId","contactId","type","normalizedValue","verified","source","createdAt") VALUES ($1,$2,$3,'PHONE',$4,false,'MANUAL_ENTRY',CURRENT_TIMESTAMP) ON CONFLICT ("contactId","type","normalizedValue") DO NOTHING`, [randomUUID(), workspaceId, contactId, normalized]);
    await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","details","createdAt") VALUES ($1,$2,$3,'CONTACT_CREATED','CONTACT',$4,$5::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, ownerUserId ?? null, contactId, JSON.stringify({ source: "MANUAL_ENTRY" })]);
    const rules = await client.query<Row>(`SELECT r."channelOrder" FROM "RoutingRule" r JOIN "Contact" c ON c."id"=$2 AND c."workspaceId"=r."workspaceId" WHERE r."workspaceId"=$1 AND r."enabled"=true AND COALESCE(r."conditions"->>'teamId','')='' AND (COALESCE(r."conditions"->>'phonePrefix','')='' OR $3 LIKE (r."conditions"->>'phonePrefix') || '%') AND (COALESCE(r."conditions"->>'segmentId','')='' OR EXISTS (SELECT 1 FROM "CustomerSegment" seg WHERE seg."workspaceId"=r."workspaceId" AND seg."id"=r."conditions"->>'segmentId' AND (COALESCE(seg."filters"->>'tag','')='' OR c."tags" @> ARRAY[seg."filters"->>'tag']) AND (COALESCE(seg."filters"->>'source','')='' OR lower(COALESCE(c."source",''))=lower(seg."filters"->>'source')) AND (COALESCE(seg."filters"->>'ownerUserId','')='' OR c."ownerUserId"=seg."filters"->>'ownerUserId') AND (COALESCE(seg."filters"->>'consent','any')='any' OR COALESCE((SELECT cr."status"::text FROM "ConsentRecord" cr WHERE cr."workspaceId"=c."workspaceId" AND cr."contactId"=c."id" AND cr."channel"='WHATSAPP' AND cr."scope"='WHATSAPP_MESSAGING' ORDER BY cr."capturedAt" DESC,cr."id" DESC LIMIT 1),'UNKNOWN')=CASE seg."filters"->>'consent' WHEN 'opted_in' THEN 'OPTED_IN' WHEN 'opted_out' THEN 'OPTED_OUT' ELSE 'UNKNOWN' END))) ORDER BY (r."conditions" ? 'segmentId') DESC,length(COALESCE(r."conditions"->>'phonePrefix','')) DESC,r."priority",r."createdAt" LIMIT 1`, [workspaceId, contactId, normalized.replace(/\D/g, "")]);
    const activeNumbers = await client.query<Row>(`SELECT n."id" FROM "ChannelNumber" n WHERE n."workspaceId"=$1 AND n."state"='ACTIVE' AND (n."approvedByUserId" IS NOT NULL OR n."approvedAt" IS NOT NULL OR n."provider" = 'TWILIO' OR n."twilioAccountId" IS NOT NULL OR n."twilioAccountSid" IS NOT NULL)
      AND (
        (n."provider" = 'TWILIO' OR n."twilioAccountId" IS NOT NULL OR n."twilioAccountSid" IS NOT NULL)
        OR (n."metaPhoneNumberId" IS NOT NULL AND ((n."whatsappConnectionId" IS NULL AND $2::boolean) OR EXISTS (SELECT 1 FROM "WhatsAppConnection" connection WHERE connection."id"=n."whatsappConnectionId" AND connection."workspaceId"=n."workspaceId" AND connection."status"='ACTIVE' AND (connection."tokenExpiresAt" IS NULL OR connection."tokenExpiresAt">CURRENT_TIMESTAMP))))
      )
      ORDER BY n."routingPriority",n."createdAt"`, [workspaceId, Boolean(process.env.META_ACCESS_TOKEN)]);
    const activeIds = new Set(activeNumbers.rows.map((row) => String(row.id)));
    const hasMatchingRule = rules.rows.length > 0;
    const preferredIds = Array.isArray(rules.rows[0]?.channelOrder) ? rules.rows[0].channelOrder.map(String).filter((id) => activeIds.has(id)) : [];
    const senderId = preferredIds[0] ?? (hasMatchingRule ? null : activeNumbers.rows[0]?.id);
    if (senderId) await client.query(`INSERT INTO "Conversation" ("id","workspaceId","contactId","channelNumberId","state","assignedUserId","unreadCount","lastMessageAt","createdAt","updatedAt") VALUES ($1,$2,$3,$4,'OPEN',$5,0,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, contactId, String(senderId), ownerUserId ?? null]);
    await client.query("COMMIT");
    return { id: contactId, name: cleanName, phone: normalized, preview: "No conversation yet", time: "Just added", state: "Open", messagingConsent: "unknown", messages: [] };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error instanceof Error && (error as { code?: string }).code === "23505") throw new Error("A customer with this phone number already exists.");
    throw error;
  } finally { client.release(); }
}

export async function mutatePostgresStore<T>(mutate: (store: Store) => T): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const workspaceId = await ensureWorkspace(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`whatsapp-crm-store:${workspaceId}`]);
    await importLocalStoreOnce(client, workspaceId);
    const previous = await loadStore(client, workspaceId);
    const store = structuredClone(previous);
    const result = mutate(store);
    await saveStore(client, workspaceId, store, previous);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
