import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

export type ChannelNumber = {
  id: string;
  label: string;
  number: string;
  metaPhoneNumberId?: string;
  metaWabaId?: string;
  displayName?: string;
  qualitySignal?: string;
  allowedTeamIds?: string[];
  routingPriority?: number;
  lastStatusEventAt?: string;
  metaConnectionStatus?: "CONNECTED" | "EXPIRING" | "EXPIRED" | "INACTIVE" | "UNLINKED" | "CONNECTION_MISSING" | "SERVER_TOKEN";
  metaTokenExpiresAt?: string | null;
  state: "Active" | "Pending approval" | "Paused" | "Degraded" | "Restricted" | "Disconnected" | "Archived";
  createdAt: string;
};

export type StoredMessage = { id: string; text: string; time: string; createdAt?: string; mine?: boolean; senderNumberId: string; status: "local" | "queued" | "sent" | "delivered" | "read" | "failed" | "unknown"; failureClass?: string; media?: { type: string; mimeType?: string; filename?: string; size?: number; caption?: string; mediaId?: string; stored?: boolean; storageStatus?: string; messageId?: string; accessUrl?: string } };
export type StoredNote = { id: string; text: string; author: string; time: string; createdAt: string };
export type MessagingConsent = "unknown" | "opted_in" | "opted_out";
export type StoredConsentRecord = { id: string; status: Exclude<MessagingConsent, "unknown">; source: string; wordingVersion?: string; updatedAt: string; updatedBy: string };
export type StoredChat = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  additionalPhones?: string[];
  email?: string;
  source?: string;
  ownerUserId?: string;
  ownerName?: string;
  customFields?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
  preview: string;
  time: string;
  unread?: number;
  state?: "Open" | "Waiting" | "Resolved";
  assignedTo?: string;
  assignedUserId?: string;
  assignedTeamId?: string;
  assignedTeam?: string;
  conversationAssignments?: { channelNumberId: string; assignedTeamId?: string; assignedUserId?: string; state?: "Open" | "Waiting" | "Resolved"; unreadCount?: number }[];
  eligibleSenderNumberIds?: string[];
  channelNumberIds?: string[];
  currentSenderNumberId?: string;
  label?: string;
  tags?: string[];
  internalNotes?: StoredNote[];
  messagingConsent?: MessagingConsent;
  consentSource?: string;
  consentUpdatedAt?: string;
  consentUpdatedBy?: string;
  consentHistory?: StoredConsentRecord[];
  legalHoldAt?: string | null;
  legalHoldReason?: string | null;
  color: string;
  messages: StoredMessage[];
};

export type Store = {
  numbers: ChannelNumber[];
  chats: StoredChat[];
  users: { id: string; email: string; passwordHash: string; name: string; role: "Owner" | "Admin" | "Supervisor" | "Agent"; active: boolean }[];
};

const storePath = process.env.CRM_STORE_PATH || path.join(process.cwd(), "data", "crm-store.json");
const tempStorePath = `${storePath}.tmp`;
let writeQueue = Promise.resolve();

const seed: Store = {
  numbers: [
    { id: "number-main", label: "Main Support", number: "+91 80 4567 8900", state: "Active", createdAt: new Date().toISOString() },
    { id: "number-sales", label: "Sales Team", number: "+91 80 4567 8901", state: "Active", createdAt: new Date().toISOString() },
    { id: "number-returns", label: "Returns", number: "+91 80 4567 8902", state: "Active", createdAt: new Date().toISOString() },
  ],
  chats: [
    { id: "contact-olivia", name: "Olivia Rhye", initials: "OR", phone: "+91 98765 43210", preview: "That sounds perfect, thank you!", time: "10:42 AM", unread: 2, state: "Open", label: "New lead", color: "bg-rose-100 text-rose-700", messages: [{ id: "msg-o1", text: "Hi, I saw your product on Instagram and wanted to know more about the team plan.", time: "10:36 AM", senderNumberId: "number-main", status: "local" }, { id: "msg-o2", text: "Hey Olivia! Happy to help. How many people are you looking to support?", time: "10:39 AM", mine: true, senderNumberId: "number-main", status: "local" }, { id: "msg-o3", text: "We have around 12 people right now, and hoping to grow this year.", time: "10:40 AM", senderNumberId: "number-main", status: "local" }, { id: "msg-o4", text: "That sounds perfect, thank you!", time: "10:42 AM", senderNumberId: "number-main", status: "local" }] },
    { id: "contact-phoenix", name: "Phoenix Baker", initials: "PB", phone: "+91 91234 56789", preview: "Could we schedule a quick call tomorrow?", time: "9:18 AM", color: "bg-violet-100 text-violet-700", messages: [{ id: "msg-p1", text: "Could we schedule a quick call tomorrow?", time: "9:18 AM", senderNumberId: "number-sales", status: "local" }] },
    { id: "contact-lana", name: "Lana Steiner", initials: "LS", phone: "+91 99887 66554", preview: "The invoice has been paid.", time: "Yesterday", label: "Customer", color: "bg-amber-100 text-amber-700", messages: [{ id: "msg-l1", text: "The invoice has been paid.", time: "Yesterday", senderNumberId: "number-main", status: "local" }] },
    { id: "contact-demi", name: "Demi Wilkinson", initials: "DW", phone: "+91 97654 32109", preview: "Thanks for getting back to me so quickly", time: "Yesterday", color: "bg-sky-100 text-sky-700", messages: [{ id: "msg-d1", text: "Thanks for getting back to me so quickly", time: "Yesterday", senderNumberId: "number-main", status: "local" }] },
    { id: "contact-candice", name: "Candice Wu", initials: "CW", phone: "+91 93456 78901", preview: "Are there any updates on my order?", time: "Mon", unread: 1, color: "bg-emerald-100 text-emerald-700", messages: [{ id: "msg-c1", text: "Are there any updates on my order?", time: "Monday", senderNumberId: "number-returns", status: "local" }] },
    { id: "contact-natali", name: "Natali Craig", initials: "NC", phone: "+91 90123 45678", preview: "I'll check and get back to you shortly.", time: "Mon", color: "bg-orange-100 text-orange-700", messages: [{ id: "msg-n1", text: "I'll check and get back to you shortly.", time: "Monday", mine: true, senderNumberId: "number-main", status: "local" }] },
    { id: "contact-drew", name: "Drew Cano", initials: "DC", phone: "+91 94567 12345", preview: "Voice message · 0:18", time: "Sun", color: "bg-indigo-100 text-indigo-700", messages: [{ id: "msg-dr1", text: "Voice message · 0:18", time: "Sunday", senderNumberId: "number-main", status: "local" }] },
  ],
  users: [],
};

// Built-in demo records for local development. The PostgreSQL import skips these so they never reach a real workspace.
export const demoSeedChatIds = new Set(seed.chats.map((chat) => chat.id));
export const demoSeedNumberIds = new Set(seed.numbers.map((number) => number.id));

async function readStore(contactIds?: string[]): Promise<Store> {
  if (process.env.DATABASE_URL) {
    const { readPostgresStore } = await import("@/lib/postgres-store");
    return readPostgresStore(contactIds);
  }
  let contents: string;
  try {
    contents = await readFile(storePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await mkdir(path.dirname(storePath), { recursive: true });
    await persistStore(structuredClone(seed));
    return structuredClone(seed);
  }
  let parsed: Store;
  try {
    parsed = JSON.parse(contents) as Store;
  } catch {
    throw new Error(`CRM data at ${storePath} is not valid JSON. The file was left untouched to protect customer history.`);
  }
  if (!parsed || !Array.isArray(parsed.chats) || !Array.isArray(parsed.numbers) || (parsed.users !== undefined && !Array.isArray(parsed.users))) {
    throw new Error(`CRM data at ${storePath} is incomplete. The file was left untouched to protect customer history.`);
  }
  return {
    ...seed,
    ...parsed,
    users: (parsed.users ?? []).map((user) => ({
      ...user,
      id: user.id || randomUUID(),
      role: user.role || "Owner",
      active: user.active ?? true,
    })),
  };
}

async function persistStore(store: Store) {
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(tempStorePath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await rename(tempStorePath, storePath);
}

async function mutateStore<T>(mutate: (store: Store) => T): Promise<T> {
  if (process.env.DATABASE_URL) {
    const { mutatePostgresStore } = await import("@/lib/postgres-store");
    return mutatePostgresStore(mutate);
  }
  let result!: T;
  const task = writeQueue.then(async () => {
    const store = await readStore();
    result = mutate(store);
    await persistStore(store);
  });
  writeQueue = task.catch(() => undefined);
  await task;
  return result;
}

export async function getCrmSnapshot(contactIds?: string[]) {
  const store = await readStore(contactIds);
  return {
    chats: store.chats,
    numbers: [...store.numbers].sort((a, b) => (a.routingPriority ?? store.numbers.indexOf(a) * 100) - (b.routingPriority ?? store.numbers.indexOf(b) * 100)).map(({ id, label, number, state, metaPhoneNumberId, metaWabaId, displayName, qualitySignal, allowedTeamIds, routingPriority, lastStatusEventAt }) => ({ id, label, number, state, metaPhoneNumberId, metaWabaId, displayName, qualitySignal, allowedTeamIds: allowedTeamIds ?? [], routingPriority, lastStatusEventAt })),
    team: store.users.filter((user) => user.active).map(({ id, name, email, role }) => ({ id, name, email, role })),
  };
}

export async function getTeamAdminSnapshot() {
  const store = await readStore();
  return store.users.map(({ id, name, email, role, active }) => ({ id, name, email, role, active }));
}

export async function updateTeamMember(input: { id: string; action: "change_role" | "activate" | "deactivate"; role?: "Admin" | "Supervisor" | "Agent"; actorUserId: string }) {
  if (!input.id) throw new Error("Team member ID is required.");
  if (process.env.DATABASE_URL) {
    const { randomUUID } = await import("node:crypto");
    const { getPostgresPool, getWorkspaceId } = await import("@/lib/postgres-pool");
    const client = await getPostgresPool().connect();
    try {
      await client.query("BEGIN");
      const workspaceId = getWorkspaceId();
      const result = await client.query<{ id: string; name: string; email: string; active: boolean; role: string }>(`SELECT u."id",u."name",u."email",u."active",wu."role" FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId" WHERE wu."workspaceId"=$1 AND u."id"=$2 FOR UPDATE OF wu,u`, [workspaceId, input.id]);
      const member = result.rows[0];
      if (!member) throw new Error("Team member not found.");
      if (String(member.role) === "OWNER") throw new Error("Owner access must be transferred through the workspace recovery process.");
      if (input.action === "change_role") {
        if (!input.role || !["Admin", "Supervisor", "Agent"].includes(input.role)) throw new Error("Choose Admin, Supervisor, or Agent.");
        await client.query(`UPDATE "WorkspaceUser" SET "role"=$3::"WorkspaceRole" WHERE "workspaceId"=$1 AND "userId"=$2`, [workspaceId, input.id, input.role.toUpperCase()]);
      } else {
        await client.query(`UPDATE "User" SET "active"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [input.id, input.action === "activate"]);
      }
      if (input.action !== "activate" || !member.active) {
        await client.query(`UPDATE "AuthSession" SET "revokedAt"=CURRENT_TIMESTAMP WHERE "workspaceId"=$1 AND "userId"=$2 AND "revokedAt" IS NULL`, [workspaceId, input.id]);
      }
      const nextRole = input.action === "change_role" ? input.role! : ({ OWNER: "Owner", ADMIN: "Admin", SUPERVISOR: "Supervisor", AGENT: "Agent" } as Record<string,string>)[String(member.role)];
      const nextActive = input.action === "deactivate" ? false : input.action === "activate" ? true : member.active;
      await client.query(`INSERT INTO "AuditEvent" ("id","workspaceId","actorUserId","action","targetType","targetId","before","after","createdAt") VALUES ($1,$2,$3,$4,'USER',$5,$6::jsonb,$7::jsonb,CURRENT_TIMESTAMP)`, [randomUUID(), workspaceId, input.actorUserId, `TEAM_MEMBER_${input.action.toUpperCase()}`, input.id, JSON.stringify({ role: member.role, active: member.active }), JSON.stringify({ role: nextRole.toUpperCase(), active: nextActive })]);
      await client.query("COMMIT");
      return { id: member.id, name: member.name, email: member.email, role: nextRole, active: nextActive };
    } catch (error) { try { await client.query("ROLLBACK"); } catch {} throw error; }
    finally { client.release(); }
  }
  return mutateStore((store) => {
    const member = store.users.find((user) => user.id === input.id);
    if (!member) throw new Error("Team member not found.");
    if (member.role === "Owner") throw new Error("Owner access must be transferred through the workspace recovery process.");
    if (input.action === "change_role") {
      if (!input.role) throw new Error("Choose Admin, Supervisor, or Agent.");
      member.role = input.role;
    } else member.active = input.action === "activate";
    return { id: member.id, name: member.name, email: member.email, role: member.role, active: member.active };
  });
}

export async function addLocalMessage(chatId: string, text: string, senderNumberId: string) {
  return mutateStore((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    const number = store.numbers.find((item) => item.id === senderNumberId && item.state === "Active");
    if (!chat) throw new Error("Conversation not found.");
    if (!number) throw new Error("Choose an active, approved number.");
    if (chat.messagingConsent !== "opted_in") throw new Error(chat.messagingConsent === "opted_out" ? "This customer has opted out of WhatsApp messages. Record new consent before replying." : "Messaging is disabled until customer consent is recorded.");
    const now = new Date();
    const time = now.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
    const message: StoredMessage = { id: randomUUID(), text, time, createdAt: now.toISOString(), mine: true, senderNumberId, status: "local" };
    chat.messages.push(message);
    chat.preview = text;
    chat.time = time;
    return { chat, message };
  });
}

export async function updateLocalConsent(chatId: string, status: Exclude<MessagingConsent, "unknown">, source: string, actor: string, wordingVersion: string) {
  return mutateStore((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) throw new Error("Contact not found.");
    const cleanSource = source.trim();
    if (!cleanSource) throw new Error("Record where or how the customer gave this consent.");
    if (cleanSource.length > 300) throw new Error("Consent source must be 300 characters or fewer.");
    const cleanWordingVersion = wordingVersion.trim();
    if (!cleanWordingVersion) throw new Error("Record the consent wording version.");
    if (cleanWordingVersion.length > 100) throw new Error("Consent wording version must be 100 characters or fewer.");
    chat.messagingConsent = status;
    chat.consentSource = cleanSource;
    chat.consentUpdatedAt = new Date().toISOString();
    chat.consentUpdatedBy = actor;
    chat.consentHistory ??= [];
    chat.consentHistory.push({ id: randomUUID(), status, source: cleanSource, wordingVersion: cleanWordingVersion, updatedAt: chat.consentUpdatedAt, updatedBy: actor });
    return chat;
  });
}

export async function updateLocalConversation(chatId: string, action: "read" | "resolve" | "reopen" | "wait" | "assign" | "add_tag" | "remove_tag", assignee?: string | null, tag?: string) {
  return mutateStore((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) throw new Error("Conversation not found.");
    if (action === "read") chat.unread = undefined;
    if (action === "resolve") chat.state = "Resolved";
    if (action === "reopen") chat.state = "Open";
    if (action === "wait") chat.state = "Waiting";
    if (action === "assign") {
      if (assignee) {
        const member = store.users.find((user) => user.active && user.name === assignee);
        if (!member) throw new Error("Choose an active team member.");
        chat.assignedTo = member.name;
      } else chat.assignedTo = undefined;
    }
    if (action === "add_tag") {
      const cleanTag = tag?.trim();
      if (!cleanTag || cleanTag.length > 32) throw new Error("Tag must be between 1 and 32 characters.");
      chat.tags ??= chat.label ? [chat.label] : [];
      if (!chat.tags.includes(cleanTag)) chat.tags.push(cleanTag);
    }
    if (action === "remove_tag") {
      chat.tags ??= chat.label ? [chat.label] : [];
      chat.tags = chat.tags.filter((item) => item !== tag);
    }
    return chat;
  });
}

export async function addInternalNote(chatId: string, text: string, author: string) {
  return mutateStore((store) => {
    const chat = store.chats.find((item) => item.id === chatId);
    if (!chat) throw new Error("Conversation not found.");
    const cleanText = text.trim();
    if (!cleanText) throw new Error("Write a note before saving.");
    if (cleanText.length > 5000) throw new Error("Internal notes must be 5,000 characters or fewer.");
    const createdAt = new Date().toISOString();
    const note: StoredNote = { id: randomUUID(), text: cleanText, author, time: new Date(createdAt).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), createdAt };
    chat.internalNotes ??= [];
    chat.internalNotes.push(note);
    return { chat, note };
  });
}

export async function createLocalContact(name: string, phone: string, ownerUserId?: string) {
  if (process.env.DATABASE_URL) {
    const { createPostgresContact } = await import("@/lib/postgres-store");
    return createPostgresContact(name, phone, ownerUserId);
  }
  return mutateStore((store) => {
    const normalized = phone.replace(/[\s()-]/g, "");
    if (!name.trim()) throw new Error("Customer name is required.");
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error("Enter a phone number in international format, such as +14155550123.");
    if (store.chats.some((item) => item.phone.replace(/[\s()-]/g, "") === normalized)) throw new Error("A customer with this phone number already exists.");
    const colors = ["bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700"];
    const initials = name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
    const owner = ownerUserId ? store.users.find((user) => user.id === ownerUserId && user.active) : undefined;
    if (ownerUserId && !owner) throw new Error("Choose an active owner in this workspace.");
    const contact: StoredChat = { id: randomUUID(), name: name.trim(), initials, phone: normalized, ownerUserId: owner?.id, ownerName: owner?.name, preview: "No conversation yet", time: "Just added", state: "Open", messagingConsent: "unknown", color: colors[store.chats.length % colors.length], messages: [] };
    store.chats.unshift(contact);
    return contact;
  });
}

export async function updateLocalContact(input: { id: string; name: string; phone: string; email?: string | null; source?: string | null; ownerUserId?: string | null; tags: string[]; customFields: Record<string, unknown> }) {
  return mutateStore((store) => {
    const chat = store.chats.find((item) => item.id === input.id);
    if (!chat) throw new Error("Customer not found.");
    if (store.chats.some((item) => item.id !== input.id && item.phone.replace(/[\s()-]/g, "") === input.phone)) throw new Error("A customer with this phone number already exists.");
    const owner = input.ownerUserId ? store.users.find((user) => user.id === input.ownerUserId && user.active) : undefined;
    if (input.ownerUserId && !owner) throw new Error("Choose an active owner in this workspace.");
    chat.name = input.name;
    chat.initials = input.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("");
    chat.phone = input.phone;
    chat.email = input.email ?? undefined;
    chat.source = input.source ?? undefined;
    chat.ownerUserId = owner?.id;
    chat.ownerName = owner?.name;
    chat.tags = input.tags;
    chat.label = input.tags[0];
    chat.customFields = input.customFields;
    chat.updatedAt = new Date().toISOString();
    return chat;
  });
}

export async function createChannelNumber(label: string, number: string, metaPhoneNumberId?: string, metaWabaId?: string) {
  return mutateStore((store) => {
    const normalized = number.replace(/[\s()-]/g, "");
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) throw new Error("Enter a phone number in international format, such as +14155550123.");
    if (metaPhoneNumberId?.trim() && !/^\d+$/.test(metaPhoneNumberId.trim())) throw new Error("Meta phone number ID must contain digits only.");
    if (metaPhoneNumberId?.trim() && store.numbers.some((item) => item.metaPhoneNumberId === metaPhoneNumberId.trim())) throw new Error("That Meta phone number ID is already connected in this workspace.");
    if (metaWabaId?.trim() && !/^\d+$/.test(metaWabaId.trim())) throw new Error("Meta WhatsApp Business Account ID must contain digits only.");
    if (store.numbers.some((item) => item.number.replace(/[\s()-]/g, "") === normalized)) throw new Error("That number is already in your workspace.");
    const channel: ChannelNumber = { id: randomUUID(), label: label.trim() || "New number", number: normalized, metaPhoneNumberId: metaPhoneNumberId?.trim() || undefined, metaWabaId: metaWabaId?.trim() || undefined, routingPriority: (store.numbers.length + 1) * 100, state: "Pending approval", createdAt: new Date().toISOString() };
    store.numbers.push(channel);
    return channel;
  });
}

export async function updateChannelNumber(id: string, action: "approve" | "pause" | "activate" | "archive" | "rename" | "set_allowed_teams", label?: string, allowedTeamIds?: string[]) {
  return mutateStore((store) => {
    const channel = store.numbers.find((item) => item.id === id);
    if (!channel) throw new Error("Number not found.");
    if (action === "approve") {
      if (channel.state !== "Pending approval") throw new Error("Only a pending number can be approved.");
      if (!channel.metaPhoneNumberId || !channel.metaWabaId) throw new Error("Add the connected Meta phone number ID and WABA ID before approving this sender number.");
      channel.state = "Active";
    }
    if (action === "activate") {
      if (channel.state !== "Paused" && channel.state !== "Disconnected") throw new Error("Only a paused or disconnected number can be reactivated.");
      if (!channel.metaPhoneNumberId || !channel.metaWabaId) throw new Error("Reconnect this number to its Meta phone number ID and WABA before activating it.");
      channel.state = "Active";
    }
    if (action === "pause") {
      if (channel.state !== "Active" && channel.state !== "Degraded") throw new Error("Only an active or degraded number can be paused.");
      channel.state = "Paused";
    }
    if (action === "archive") {
      if (channel.state === "Archived") throw new Error("This number is already archived.");
      channel.state = "Archived";
    }
    if (action === "rename") {
      const cleanLabel = label?.trim();
      if (!cleanLabel || cleanLabel.length > 80) throw new Error("Number label must be between 1 and 80 characters.");
      channel.label = cleanLabel;
    }
    if (action === "set_allowed_teams") channel.allowedTeamIds = [...new Set(allowedTeamIds ?? [])];
    return channel;
  });
}

export async function moveChannelNumber(id: string, direction: "up" | "down") {
  return mutateStore((store) => {
    const index = store.numbers.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("Number not found.");
    const next = direction === "up" ? index - 1 : index + 1;
    if (next < 0 || next >= store.numbers.length) return store.numbers[index];
    [store.numbers[index], store.numbers[next]] = [store.numbers[next], store.numbers[index]];
    store.numbers.forEach((item, order) => { item.routingPriority = (order + 1) * 100; });
    return store.numbers[next];
  });
}

export async function registerOwner(email: string, password: string, name: string) {
  return mutateStore((store) => {
    if (store.users.length > 0) throw new Error("An owner account already exists.");
    const salt = randomBytes(16).toString("hex");
    const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
    store.users.push({ id: randomUUID(), email: email.toLowerCase(), passwordHash, name, role: "Owner", active: true });
    return { email: email.toLowerCase(), name, role: "Owner" as const };
  });
}

export async function authenticateOwner(email: string, password: string) {
  let user: { email: string; name: string; passwordHash: string; role: Store["users"][number]["role"]; active: boolean } | undefined;
  if (process.env.DATABASE_URL) {
    const { getPostgresPool, getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = await getPostgresPool().query(`SELECT u."email", u."name", u."passwordHash", u."active", wu."role"
      FROM "User" u JOIN "WorkspaceUser" wu ON wu."userId" = u."id"
      WHERE wu."workspaceId" = $1 AND lower(u."email") = lower($2) LIMIT 1`, [getWorkspaceId(), email]);
    const row = result.rows[0] as { email: string; name: string; passwordHash: string; active: boolean; role: string } | undefined;
    if (row) {
      const role = ({ OWNER: "Owner", ADMIN: "Admin", SUPERVISOR: "Supervisor", AGENT: "Agent" } as Record<string, Store["users"][number]["role"]>)[row.role];
      if (role) user = { ...row, role };
    }
  } else {
    const store = await readStore();
    user = store.users.find((item) => item.email === email.toLowerCase() && item.active);
  }
  if (!user?.active) {
    scryptSync(password, "crm-login-dummy-salt", 64);
    return null;
  }
  const [, salt, expectedHex] = user.passwordHash.split(":");
  if (!salt || !expectedHex) {
    scryptSync(password, "crm-login-dummy-salt", 64);
    return null;
  }
  const expected = Buffer.from(expectedHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return user ? { email: user.email, name: user.name, role: user.role } : null;
}

export async function getAuthUser(email: string) {
  if (process.env.DATABASE_URL) {
    const { getPostgresPool, getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = await getPostgresPool().query(`SELECT u."id", u."email", u."name", u."active", wu."role"
      FROM "User" u JOIN "WorkspaceUser" wu ON wu."userId" = u."id"
      WHERE wu."workspaceId" = $1 AND lower(u."email") = lower($2) LIMIT 1`, [getWorkspaceId(), email]);
    const user = result.rows[0] as { id: string; email: string; name: string; active: boolean; role: string } | undefined;
    if (!user?.active) return null;
    const role = ({ OWNER: "Owner", ADMIN: "Admin", SUPERVISOR: "Supervisor", AGENT: "Agent" } as Record<string, Store["users"][number]["role"]>)[user.role];
    return role ? { id: user.id, email: user.email, name: user.name, role } : null;
  }
  const store = await readStore();
  const user = store.users.find((item) => item.email === email.toLowerCase() && item.active);
  return user ? { id: user.id, email: user.email, name: user.name, role: user.role } : null;
}

export async function changeAccountPassword(email: string, password: string) {
  if (password.length < 12 || password.length > 1024) throw new Error("Use a password between 12 and 1,024 characters.");
  const salt = randomBytes(16).toString("hex");
  const passwordHash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
  if (process.env.DATABASE_URL) {
    const { getPostgresPool, getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = await getPostgresPool().query(`UPDATE "User" u SET "passwordHash" = $3, "updatedAt" = CURRENT_TIMESTAMP
      FROM "WorkspaceUser" wu WHERE wu."userId" = u."id" AND wu."workspaceId" = $1 AND lower(u."email") = lower($2) AND u."active" = true RETURNING u."id"`, [getWorkspaceId(), email, passwordHash]);
    if (!result.rows.length) throw new Error("Active account not found.");
    return String(result.rows[0].id);
  }
  return mutateStore((store) => {
    const user = store.users.find((item) => item.email === email.toLowerCase() && item.active);
    if (!user) throw new Error("Active account not found.");
    user.passwordHash = passwordHash;
    return user.id;
  });
}

export async function hasOwner() {
  if (process.env.DATABASE_URL) {
    const { getPostgresPool, getWorkspaceId } = await import("@/lib/postgres-pool");
    const result = await getPostgresPool().query(`SELECT 1 FROM "WorkspaceUser" WHERE "workspaceId" = $1 AND "role" = 'OWNER'::"WorkspaceRole" LIMIT 1`, [getWorkspaceId()]);
    return result.rows.length > 0;
  }
  const store = await readStore();
  return store.users.length > 0;
}
