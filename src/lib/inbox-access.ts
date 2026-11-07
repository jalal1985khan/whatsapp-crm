import "server-only";

import type { StoredChat } from "@/lib/crm-store";
import { getCrmSnapshot } from "@/lib/crm-store";
import { getPostgresPool, getWorkspaceId } from "@/lib/postgres-pool";

export type InboxActor = { userId: string; name: string; role: string };

function canAccessLocalChat(chat: StoredChat, actor: InboxActor) {
  if (actor.role === "Owner" || actor.role === "Admin") return true;
  if (chat.assignedUserId) return chat.assignedUserId === actor.userId;
  if (chat.assignedTo) return chat.assignedTo === actor.name;
  return !chat.assignedTeamId;
}

function conversationScope(role: string, userParameter = "$3") {
  if (role === "Owner" || role === "Admin") return `TRUE`;
  if (role === "Supervisor") return `(c."assignedUserId"=${userParameter} OR (c."assignedUserId" IS NULL AND c."assignedTeamId" IS NULL) OR c."assignedTeamId" IN (SELECT tm."teamId" FROM "TeamMembership" tm WHERE tm."workspaceId"=$1 AND tm."userId"=${userParameter}))`;
  return `(c."assignedUserId"=${userParameter} OR (c."assignedUserId" IS NULL AND c."assignedTeamId" IS NULL))`;
}

export async function canAccessConversation(actor: InboxActor, contactId: string, channelNumberId?: string) {
  if (actor.role === "Owner" || actor.role === "Admin") return true;
  if (!process.env.DATABASE_URL) {
    const snapshot = await getCrmSnapshot();
    const chat = snapshot.chats.find((item) => item.id === contactId);
    return Boolean(chat && canAccessLocalChat(chat, actor) && (!channelNumberId || chat.channelNumberIds?.includes(channelNumberId)));
  }
  const params: unknown[] = [getWorkspaceId(), contactId, actor.userId];
  const numberClause = channelNumberId ? ` AND c."channelNumberId"=$4` : "";
  if (channelNumberId) params.push(channelNumberId);
  const result = await getPostgresPool().query(`SELECT 1 FROM "Conversation" c WHERE c."workspaceId"=$1 AND c."contactId"=$2 AND ${conversationScope(actor.role)}${numberClause} LIMIT 1`, params);
  return result.rows.length > 0;
}

export async function canSendOnConversation(actor: InboxActor, contactId: string, channelNumberId: string) {
  if (actor.role === "Owner" || actor.role === "Admin") return true;
  if (!process.env.DATABASE_URL) return canAccessConversation(actor, contactId);
  const targetThread = await getPostgresPool().query(`SELECT 1 FROM "Conversation" WHERE "workspaceId"=$1 AND "contactId"=$2 AND "channelNumberId"=$3 LIMIT 1`, [getWorkspaceId(), contactId, channelNumberId]);
  return canAccessConversation(actor, contactId, targetThread.rows.length ? channelNumberId : undefined);
}

export async function canAccessContactRecord(actor: InboxActor, contactId: string) {
  if (await canAccessConversation(actor, contactId)) return true;
  if (actor.role === "Owner" || actor.role === "Admin") return true;
  if (!process.env.DATABASE_URL) {
    const snapshot = await getCrmSnapshot();
    const chat = snapshot.chats.find((item) => item.id === contactId);
    return Boolean(chat && (chat.ownerUserId === actor.userId || canAccessLocalChat(chat, actor)));
  }
  const result = await getPostgresPool().query(`SELECT 1 FROM "Contact" WHERE "workspaceId"=$1 AND "id"=$2 AND "ownerUserId"=$3 LIMIT 1`, [getWorkspaceId(), contactId, actor.userId]);
  return result.rows.length > 0;
}

export async function getScopedInboxSnapshot(actor: InboxActor, requestedContactIds?: string[]) {
  if (!process.env.DATABASE_URL) {
    const snapshot = await getCrmSnapshot();
    const requested = requestedContactIds ? new Set(requestedContactIds) : null;
    if (actor.role === "Owner" || actor.role === "Admin") return requested ? { ...snapshot, chats: snapshot.chats.filter((chat) => requested.has(chat.id)) } : snapshot;
    return { ...snapshot, chats: snapshot.chats.filter((chat) => (!requested || requested.has(chat.id)) && canAccessLocalChat(chat, actor)), team: snapshot.team.filter((member) => member.id === actor.userId) };
  }

  const isAdmin = actor.role === "Owner" || actor.role === "Admin";
  let contactIds: string[] | undefined = isAdmin ? requestedContactIds : undefined;
  if (!isAdmin) {
    const visibleContacts = await getPostgresPool().query<{ id: string }>(
      `SELECT contact."id" FROM "Contact" contact
       WHERE contact."workspaceId"=$1 AND contact."mergedIntoContactId" IS NULL
         AND ($3::text[] IS NULL OR contact."id"=ANY($3::text[]))
         AND (contact."ownerUserId"=$2 OR EXISTS (
           SELECT 1 FROM "Conversation" c WHERE c."workspaceId"=$1 AND c."contactId"=contact."id" AND ${conversationScope(actor.role, "$2")}
         ))`,
      [getWorkspaceId(), actor.userId, requestedContactIds ?? null],
    );
    contactIds = visibleContacts.rows.map((row) => row.id);
  }
  const snapshot = await getCrmSnapshot(contactIds);

  const eligibleByContact = new Map<string, string[]>();
  if (contactIds === undefined || contactIds.length > 0) {
    const params: unknown[] = [getWorkspaceId()];
    const bind = (v: unknown) => { params.push(v); return `$${params.length}`; };
    const contactFilter = contactIds === undefined ? "" : ` AND contact."id"=ANY(${bind(contactIds)}::text[])`;
    const metaTokenParam = bind(Boolean(process.env.META_ACCESS_TOKEN));
    const senderAccessClause = isAdmin
      ? "TRUE"
      : `(
          (EXISTS (SELECT 1 FROM "Conversation" existing WHERE existing."workspaceId"=contact."workspaceId" AND existing."contactId"=contact."id" AND existing."channelNumberId"=number."id")
            AND EXISTS (SELECT 1 FROM "Conversation" c WHERE c."workspaceId"=contact."workspaceId" AND c."contactId"=contact."id" AND c."channelNumberId"=number."id" AND ${conversationScope(actor.role, bind(actor.userId))}))
          OR
          (NOT EXISTS (SELECT 1 FROM "Conversation" existing WHERE existing."workspaceId"=contact."workspaceId" AND existing."contactId"=contact."id" AND existing."channelNumberId"=number."id")
            AND EXISTS (SELECT 1 FROM "Conversation" c WHERE c."workspaceId"=contact."workspaceId" AND c."contactId"=contact."id" AND ${conversationScope(actor.role, bind(actor.userId))}))
        )`;

    const eligibility = await getPostgresPool().query<{ contactId: string; channelNumberId: string }>(
      `SELECT contact."id" AS "contactId",number."id" AS "channelNumberId"
       FROM "Contact" contact
       JOIN "ChannelNumber" number ON number."workspaceId"=contact."workspaceId" AND number."state"='ACTIVE' AND (number."approvedByUserId" IS NOT NULL OR number."approvedAt" IS NOT NULL OR number."provider" = 'TWILIO' OR number."twilioAccountId" IS NOT NULL OR number."twilioAccountSid" IS NOT NULL) AND (number."metaPhoneNumberId" IS NOT NULL OR number."provider" = 'TWILIO' OR number."twilioAccountId" IS NOT NULL OR number."twilioAccountSid" IS NOT NULL)
       LEFT JOIN LATERAL (SELECT conversation."id",conversation."assignedTeamId" FROM "Conversation" conversation WHERE conversation."workspaceId"=contact."workspaceId" AND conversation."contactId"=contact."id" AND conversation."channelNumberId"=number."id" LIMIT 1) target ON TRUE
       LEFT JOIN LATERAL (SELECT conversation."assignedTeamId" FROM "Conversation" conversation WHERE conversation."workspaceId"=contact."workspaceId" AND conversation."contactId"=contact."id" ORDER BY conversation."lastMessageAt" DESC,conversation."updatedAt" DESC LIMIT 1) latest ON TRUE
       LEFT JOIN LATERAL (
         SELECT rule."channelOrder" FROM "RoutingRule" rule
         WHERE rule."workspaceId"=contact."workspaceId" AND rule."enabled"=TRUE
           AND (COALESCE(rule."conditions"->>'phonePrefix','')='' OR regexp_replace(contact."primaryPhone",'\\D','','g') LIKE (rule."conditions"->>'phonePrefix') || '%')
           AND (COALESCE(rule."conditions"->>'teamId','')='' OR rule."conditions"->>'teamId'=COALESCE(CASE WHEN target."id" IS NOT NULL THEN target."assignedTeamId" ELSE latest."assignedTeamId" END,''))
           AND (COALESCE(rule."conditions"->>'segmentId','')='' OR EXISTS (
             SELECT 1 FROM "CustomerSegment" segment
             WHERE segment."workspaceId"=rule."workspaceId" AND segment."id"=rule."conditions"->>'segmentId'
               AND (COALESCE(segment."filters"->>'tag','')='' OR contact."tags" @> ARRAY[segment."filters"->>'tag'])
               AND (COALESCE(segment."filters"->>'source','')='' OR lower(COALESCE(contact."source",''))=lower(segment."filters"->>'source'))
               AND (COALESCE(segment."filters"->>'ownerUserId','')='' OR contact."ownerUserId"=segment."filters"->>'ownerUserId')
               AND (COALESCE(segment."filters"->>'consent','any')='any' OR COALESCE((SELECT consent."status"::text FROM "ConsentRecord" consent WHERE consent."workspaceId"=contact."workspaceId" AND consent."contactId"=contact."id" AND consent."channel"='WHATSAPP' AND consent."scope"='WHATSAPP_MESSAGING' ORDER BY consent."capturedAt" DESC,consent."id" DESC LIMIT 1),'UNKNOWN')=CASE segment."filters"->>'consent' WHEN 'opted_in' THEN 'OPTED_IN' WHEN 'opted_out' THEN 'OPTED_OUT' ELSE 'UNKNOWN' END)
           ))
         ORDER BY (rule."conditions" ? 'segmentId') DESC,length(COALESCE(rule."conditions"->>'phonePrefix','')) DESC,(rule."conditions" ? 'teamId') DESC,rule."priority",rule."createdAt" LIMIT 1
       ) route ON TRUE
       WHERE contact."workspaceId"=$1${contactFilter}
         AND (
           number."provider" = 'TWILIO'
           OR number."twilioAccountId" IS NOT NULL
           OR number."twilioAccountSid" IS NOT NULL
           OR (number."whatsappConnectionId" IS NULL AND ${metaTokenParam}::boolean)
           OR EXISTS (
             SELECT 1 FROM "WhatsAppConnection" connection
             WHERE connection."id"=number."whatsappConnectionId" AND connection."workspaceId"=number."workspaceId"
               AND connection."status"='ACTIVE' AND (connection."tokenExpiresAt" IS NULL OR connection."tokenExpiresAt">CURRENT_TIMESTAMP)
           )
         )
         AND (number."allowedTeamIds" IS NULL OR cardinality(number."allowedTeamIds")=0 OR COALESCE(CASE WHEN target."id" IS NOT NULL THEN target."assignedTeamId" ELSE latest."assignedTeamId" END,'')=ANY(number."allowedTeamIds"))
         AND (route."channelOrder" IS NULL OR route."channelOrder" @> to_jsonb(number."id"))
         AND ${senderAccessClause}`,
      params,
    );
    for (const row of eligibility.rows) eligibleByContact.set(row.contactId, [...(eligibleByContact.get(row.contactId) ?? []), row.channelNumberId]);
  }
  const fullSnapshot = { ...snapshot, chats: snapshot.chats.map((chat) => ({ ...chat, eligibleSenderNumberIds: eligibleByContact.get(chat.id) ?? [] })) };
  if (isAdmin) return fullSnapshot;

  const conversations = await getPostgresPool().query<{ contactId: string; channelNumberId: string; state: string; unreadCount: number; lastMessageAt: Date | string; serviceWindowExpiresAt: Date | string | null; updatedAt: Date | string; assignedUserId: string | null; assignedTo: string | null; assignedTeamId: string | null; assignedTeam: string | null }>(
    `SELECT c."contactId",c."channelNumberId",c."state",c."unreadCount",c."lastMessageAt",c."serviceWindowExpiresAt",c."updatedAt",c."assignedUserId",u."name" AS "assignedTo",c."assignedTeamId",t."name" AS "assignedTeam"
     FROM "Conversation" c LEFT JOIN "User" u ON u."id"=c."assignedUserId" LEFT JOIN "Team" t ON t."id"=c."assignedTeamId"
     WHERE c."workspaceId"=$1 AND ${conversationScope(actor.role, "$2")} AND c."contactId"=ANY($3::text[]) ORDER BY c."lastMessageAt" DESC,c."updatedAt" DESC`,
    [getWorkspaceId(), actor.userId, contactIds ?? []],
  );
  const byContact = new Map<string, typeof conversations.rows>();
  for (const conversation of conversations.rows) byContact.set(conversation.contactId, [...(byContact.get(conversation.contactId) ?? []), conversation]);
  const chats = fullSnapshot.chats.flatMap((chat) => {
    const permitted = byContact.get(chat.id) ?? [];
    if (!permitted.length && chat.ownerUserId !== actor.userId) return [];
    const channelIds = new Set(permitted.map((item) => item.channelNumberId));
    const messages = chat.messages.filter((message) => channelIds.has(message.senderNumberId));
    const latestMessage = messages.at(-1);
    const latestConversation = permitted[0];
    return [{
      ...chat,
      messages,
      preview: latestMessage?.text ?? "No conversation yet",
      time: latestMessage?.time ?? "",
      state: latestConversation ? latestConversation.state === "WAITING" ? "Waiting" as const : latestConversation.state === "RESOLVED" ? "Resolved" as const : "Open" as const : undefined,
      assignedTo: latestConversation?.assignedTo ?? undefined,
      assignedUserId: latestConversation?.assignedUserId ?? undefined,
      assignedTeamId: latestConversation?.assignedTeamId ?? undefined,
      assignedTeam: latestConversation?.assignedTeam ?? undefined,
      conversationAssignments: permitted.map((item) => ({ channelNumberId: item.channelNumberId, assignedTeamId: item.assignedTeamId ?? undefined, assignedUserId: item.assignedUserId ?? undefined, state: item.state === "WAITING" ? "Waiting" as const : item.state === "RESOLVED" ? "Resolved" as const : "Open" as const, unreadCount: Number(item.unreadCount), serviceWindowExpiresAt: item.serviceWindowExpiresAt == null ? null : new Date(item.serviceWindowExpiresAt).toISOString() })),
      channelNumberIds: [...channelIds],
      currentSenderNumberId: latestConversation?.channelNumberId,
      unread: permitted.reduce((sum, item) => sum + Number(item.unreadCount), 0) || undefined,
    }];
  });

  let visibleUserIds = [actor.userId];
  if (actor.role === "Supervisor") {
    const members = await getPostgresPool().query<{ userId: string }>(`SELECT DISTINCT peer."userId" FROM "TeamMembership" own JOIN "TeamMembership" peer ON peer."workspaceId"=own."workspaceId" AND peer."teamId"=own."teamId" WHERE own."workspaceId"=$1 AND own."userId"=$2`, [getWorkspaceId(), actor.userId]);
    visibleUserIds = [...new Set([actor.userId, ...members.rows.map((row) => row.userId)])];
  }
  return { ...fullSnapshot, chats, team: snapshot.team.filter((member) => visibleUserIds.includes(member.id)) };
}

export async function getScopedCustomerDirectorySnapshot(actor: InboxActor) {
  if (!process.env.DATABASE_URL) return getScopedInboxSnapshot(actor);

  const workspaceId = getWorkspaceId();
  const isAdmin = actor.role === "Owner" || actor.role === "Admin";
  const contacts = await getPostgresPool().query<{
    id: string; displayName: string | null; primaryPhone: string; email: string | null; source: string | null;
    ownerUserId: string | null; ownerName: string | null; tags: string[]; customFields: Record<string, unknown>;
    additionalPhones: string[];
    createdAt: Date | string; updatedAt: Date | string; legalHoldAt: Date | string | null; legalHoldReason: string | null;
    messageCount: number; preview: string | null; lastMessageAt: Date | string | null; conversationState: string | null;
    consentStatus: string | null;
  }>(
    `SELECT contact."id",contact."displayName",contact."primaryPhone",contact."email",contact."source",contact."ownerUserId",owner."name" AS "ownerName",contact."tags",contact."customFields",contact."createdAt",contact."updatedAt",contact."legalHoldAt",contact."legalHoldReason",
       ARRAY(SELECT identifier."normalizedValue" FROM "ContactIdentifier" identifier WHERE identifier."workspaceId"=contact."workspaceId" AND identifier."contactId"=contact."id" AND identifier."type"='PHONE' ORDER BY identifier."createdAt",identifier."id") AS "additionalPhones",
       COALESCE(messageStats."messageCount",0)::int AS "messageCount",latestMessage."textBody" AS "preview",latestMessage."createdAt" AS "lastMessageAt",latestConversation."state"::text AS "conversationState",latestConsent."status"::text AS "consentStatus"
     FROM "Contact" contact
     LEFT JOIN "User" owner ON owner."id"=contact."ownerUserId"
     LEFT JOIN LATERAL (SELECT COUNT(*)::int AS "messageCount" FROM "Message" message WHERE message."workspaceId"=contact."workspaceId" AND message."contactId"=contact."id" AND message."direction"<>'INTERNAL') messageStats ON TRUE
     LEFT JOIN LATERAL (SELECT message."textBody",message."createdAt" FROM "Message" message WHERE message."workspaceId"=contact."workspaceId" AND message."contactId"=contact."id" AND message."direction"<>'INTERNAL' ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1) latestMessage ON TRUE
     LEFT JOIN LATERAL (SELECT conversation."state" FROM "Conversation" conversation WHERE conversation."workspaceId"=contact."workspaceId" AND conversation."contactId"=contact."id" ORDER BY conversation."lastMessageAt" DESC,conversation."updatedAt" DESC LIMIT 1) latestConversation ON TRUE
     LEFT JOIN LATERAL (SELECT consent."status" FROM "ConsentRecord" consent WHERE consent."workspaceId"=contact."workspaceId" AND consent."contactId"=contact."id" AND consent."channel"='WHATSAPP' AND consent."scope"='WHATSAPP_MESSAGING' ORDER BY consent."capturedAt" DESC,consent."id" DESC LIMIT 1) latestConsent ON TRUE
     WHERE contact."workspaceId"=$1 AND contact."mergedIntoContactId" IS NULL
       AND ($3::boolean OR contact."ownerUserId"=$2 OR EXISTS (SELECT 1 FROM "Conversation" c WHERE c."workspaceId"=contact."workspaceId" AND c."contactId"=contact."id" AND ${conversationScope(actor.role, "$2")}))
     ORDER BY COALESCE((SELECT MAX(conversation."lastMessageAt") FROM "Conversation" conversation WHERE conversation."workspaceId"=contact."workspaceId" AND conversation."contactId"=contact."id"),contact."createdAt") DESC`,
    [workspaceId, actor.userId, isAdmin],
  );
  const team = await getPostgresPool().query<{ id: string; name: string; email: string; role: string }>(
    `SELECT DISTINCT u."id",u."name",u."email",wu."role"::text AS "role" FROM "WorkspaceUser" wu JOIN "User" u ON u."id"=wu."userId"
     WHERE wu."workspaceId"=$1 AND u."active"=TRUE AND ($3::boolean OR u."id"=$2 OR ($4::boolean AND EXISTS (SELECT 1 FROM "TeamMembership" own JOIN "TeamMembership" peer ON peer."workspaceId"=own."workspaceId" AND peer."teamId"=own."teamId" WHERE own."workspaceId"=$1 AND own."userId"=$2 AND peer."userId"=u."id")))
     ORDER BY u."name",u."id"`,
    [workspaceId, actor.userId, isAdmin, actor.role === "Supervisor"],
  );
  const colors = ["bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700"];
  const chats = contacts.rows.map((row, index) => {
    const name = row.displayName?.trim() || row.primaryPhone;
    const timestamp = row.lastMessageAt ? new Date(row.lastMessageAt) : new Date(row.createdAt);
    const now = new Date();
    const time = timestamp.toDateString() === now.toDateString()
      ? timestamp.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : timestamp.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
    const consent = row.consentStatus === "OPTED_IN" ? "opted_in" as const : row.consentStatus === "OPTED_OUT" ? "opted_out" as const : "unknown" as const;
    return {
      id: row.id, name, initials: name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join(""), phone: row.primaryPhone,
      additionalPhones: [...new Set((row.additionalPhones ?? []).filter((phone) => phone !== row.primaryPhone))],
      email: row.email ?? undefined, source: row.source ?? undefined, ownerUserId: row.ownerUserId ?? undefined, ownerName: row.ownerName ?? undefined,
      tags: row.tags ?? [], label: row.tags?.[0], customFields: row.customFields ?? {}, createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
      preview: row.preview || (Number(row.messageCount) ? "Attachment" : "No conversation yet"), time,
      state: row.conversationState === "WAITING" ? "Waiting" as const : row.conversationState === "RESOLVED" ? "Resolved" as const : "Open" as const,
      messageCount: Number(row.messageCount), messages: [] as unknown[], messagingConsent: consent,
      legalHoldAt: row.legalHoldAt ? new Date(row.legalHoldAt).toISOString() : null, legalHoldReason: row.legalHoldReason, color: colors[index % colors.length],
    };
  });
  return { chats, team: team.rows.map((row) => ({ id: row.id, name: row.name, email: row.email, role: row.role === "OWNER" ? "Owner" : row.role === "ADMIN" ? "Admin" : row.role === "SUPERVISOR" ? "Supervisor" : "Agent" })) };
}

export type InboxListFilters = { query?: string; tab?: string; state?: string; numberId?: string; teamId?: string; tag?: string; dateFrom?: string; dateTo?: string };

export async function getScopedInboxListSnapshot(actor: InboxActor, filters: InboxListFilters) {
  const queryText = filters.query?.trim().slice(0, 200) ?? "";
  if (!process.env.DATABASE_URL) {
    const metadata = await getScopedInboxSnapshot(actor);
    const chats = metadata.chats.map((chat) => {
      const threadMessages = chat.messages;
      const numberText = threadMessages.map((message) => metadata.numbers.find((number) => number.id === message.senderNumberId)).filter(Boolean).map((number) => `${number?.label} ${number?.number}`).join(" ");
      const text = [chat.name, chat.phone, ...(chat.additionalPhones ?? []), chat.preview, chat.assignedTo, chat.assignedTeam, numberText, ...(chat.tags ?? (chat.label ? [chat.label] : [])), ...threadMessages.map((message) => message.text), ...(chat.internalNotes?.map((note) => note.text) ?? [])].join(" ").toLowerCase();
      const selectedState = !filters.state || filters.state === "All states" ? undefined : filters.state;
      const tabState = ["Open", "Waiting", "Resolved"].includes(filters.tab ?? "") ? filters.tab : undefined;
      const effectiveState = selectedState ?? tabState;
      const threadFiltersActive = Boolean(effectiveState || filters.numberId || filters.teamId || filters.dateFrom || filters.dateTo || ["Mine", "Unassigned", "Team", "Unread", "Failed"].includes(filters.tab ?? ""));
      const candidateThreads = chat.conversationAssignments?.length ? chat.conversationAssignments : [{ channelNumberId: chat.currentSenderNumberId ?? threadMessages.at(-1)?.senderNumberId ?? "", assignedUserId: chat.assignedUserId, assignedTeamId: chat.assignedTeamId, state: chat.state, unreadCount: chat.unread }];
      const matchesConversation = !threadFiltersActive || candidateThreads.some((thread) => {
        const messagesOnThread = threadMessages.filter((message) => !thread.channelNumberId || message.senderNumberId === thread.channelNumberId);
        const matchesDate = (!filters.dateFrom && !filters.dateTo) || messagesOnThread.some((message) => { const day = message.createdAt?.slice(0, 10); return Boolean(day && (!filters.dateFrom || day >= filters.dateFrom) && (!filters.dateTo || day <= filters.dateTo)); });
        return (!effectiveState || thread.state === effectiveState)
        && (!filters.numberId || thread.channelNumberId === filters.numberId)
        && (!filters.teamId || thread.assignedTeamId === filters.teamId)
        && (filters.tab !== "Mine" || thread.assignedUserId === actor.userId || (!thread.assignedUserId && chat.assignedTo === actor.name))
        && (filters.tab !== "Unassigned" || (!thread.assignedUserId && !thread.assignedTeamId))
        && (filters.tab !== "Team" || Boolean(thread.assignedTeamId))
        && (filters.tab !== "Unread" || Number(thread.unreadCount ?? 0) > 0)
        && (filters.tab !== "Failed" || messagesOnThread.some((message) => message.status === "failed"))
        && matchesDate;
      });
      const matches = matchesConversation
        && (!filters.tag || (chat.tags ?? (chat.label ? [chat.label] : [])).includes(filters.tag))
        && (!queryText || text.includes(queryText.toLowerCase()));
      return { ...chat, messageCount: threadMessages.length, hasFailed: threadMessages.some((message) => message.status === "failed"), latestMessageSenderNumberId: threadMessages.at(-1)?.senderNumberId, messages: [], matchesFilter: matches };
    });
    return { ...metadata, chats };
  }
  const metadata = await getScopedInboxSnapshot(actor, []);

  const params: unknown[] = [getWorkspaceId()];
  const bind = (value: unknown) => { params.push(value); return `$${params.length}`; };
  const isAdmin = actor.role === "Owner" || actor.role === "Admin";
  let userParam: string | null = null;
  const getUserParam = () => {
    if (!userParam) userParam = bind(actor.userId);
    return userParam;
  };
  const matchClauses: string[] = [];
  const conversationFilters: string[] = [];
  if (queryText) {
    const q = bind(queryText.toLowerCase());
    matchClauses.push(`(position(${q} in lower(concat_ws(' ',b."name",b."phone",array_to_string(b."additionalPhones",' '),b."assignedTo",b."assignedTeam",b."numberText",array_to_string(b."tags",' '),b."preview")))>0
      OR EXISTS (SELECT 1 FROM "Message" m WHERE m."workspaceId"=$1 AND m."contactId"=b."id" AND m."direction"<>'INTERNAL' AND position(${q} in lower(COALESCE(m."textBody",'')))>0 AND (${isAdmin ? "TRUE" : `m."conversationId" IN (SELECT vc."id" FROM visible_conversations vc WHERE vc."contactId"=b."id")`}))
      OR EXISTS (SELECT 1 FROM "InternalNote" note WHERE note."workspaceId"=$1 AND note."contactId"=b."id" AND position(${q} in lower(note."text"))>0))`);
  }
  if (filters.tab === "Unread") conversationFilters.push(`thread."unreadCount">0`);
  if (filters.tab === "Mine") conversationFilters.push(`thread."assignedUserId"=${getUserParam()}`);
  if (filters.tab === "Unassigned") conversationFilters.push(`thread."assignedUserId" IS NULL AND thread."assignedTeamId" IS NULL`);
  if (filters.tab === "Team") conversationFilters.push(`thread."assignedTeamId" IS NOT NULL`);
  if (filters.tab === "Failed") conversationFilters.push(`EXISTS (SELECT 1 FROM "Message" failed WHERE failed."workspaceId"=$1 AND failed."conversationId"=thread."id" AND failed."status"='FAILED')`);
  if (filters.tab === "Open" || filters.tab === "Waiting" || filters.tab === "Resolved") {
    const tabState = filters.tab.toUpperCase();
    conversationFilters.push(`thread."state"=${bind(tabState)}`);
  }
  if (filters.state && filters.state !== "All states") {
    const state = filters.state === "Open" ? "OPEN" : filters.state === "Waiting" ? "WAITING" : filters.state === "Resolved" ? "RESOLVED" : filters.state;
    conversationFilters.push(`thread."state"=${bind(state)}`);
  }
  if (filters.numberId) conversationFilters.push(`thread."channelNumberId"=${bind(filters.numberId)}`);
  if (filters.teamId) conversationFilters.push(`thread."assignedTeamId"=${bind(filters.teamId)}`);
  if (filters.dateFrom || filters.dateTo) {
    const dateFrom = filters.dateFrom ? bind(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? bind(filters.dateTo) : null;
    conversationFilters.push(`EXISTS (SELECT 1 FROM "Message" dated WHERE dated."workspaceId"=$1 AND dated."conversationId"=thread."id" AND dated."direction"<>'INTERNAL'${dateFrom ? ` AND dated."createdAt">=${dateFrom}::date` : ""}${dateTo ? ` AND dated."createdAt"<(${dateTo}::date+INTERVAL '1 day')` : ""})`);
  }
  if (conversationFilters.length) matchClauses.push(`EXISTS (SELECT 1 FROM visible_conversations thread WHERE thread."contactId"=b."id" AND ${conversationFilters.join(" AND ")})`);
  if (filters.tag) matchClauses.push(`b."tags" @> ARRAY[${bind(filters.tag)}]::text[]`);
  const matchesExpression = matchClauses.length ? matchClauses.map((clause) => `(${clause})`).join(" AND ") : "TRUE";

  const userScopeClause = !isAdmin ? conversationScope(actor.role, getUserParam()) : "TRUE";
  const contactScopeClause = !isAdmin ? `contact."ownerUserId"=${getUserParam()} OR EXISTS (SELECT 1 FROM visible_conversations vc WHERE vc."contactId"=contact."id")` : "TRUE";
  const messageScopeClause = !isAdmin ? `message."conversationId" IN (SELECT vc."id" FROM visible_conversations vc WHERE vc."contactId"=contact."id")` : "TRUE";

  const result = await getPostgresPool().query<{
    id: string; name: string; initials: string; phone: string; additionalPhones: string[]; preview: string; lastActivityAt: Date | string;
    color: string; unreadCount: number; state: string; assignedTo: string | null; assignedUserId: string | null; assignedTeamId: string | null;
    assignedTeam: string | null; conversationAssignments: { channelNumberId: string; assignedTeamId?: string; assignedUserId?: string; state?: string; unreadCount?: number; serviceWindowExpiresAt?: string | null }[];
    channelNumberIds: string[]; currentSenderNumberId: string | null; latestMessageSenderNumberId: string | null;
    latestInboundMessageId: string | null; latestInboundMessageAt: Date | string | null;
    messageCount: number; hasFailed: boolean; unansweredSince: Date | string | null; tags: string[]; label: string | null; matchesFilter: boolean;
  }>(
    `WITH visible_conversations AS (
       SELECT c."id",c."contactId",c."channelNumberId",c."state",c."assignedUserId",c."assignedTeamId",c."unreadCount",c."lastMessageAt",c."serviceWindowExpiresAt",c."updatedAt"
       FROM "Conversation" c WHERE c."workspaceId"=$1 AND (${userScopeClause})
     ), visible_contacts AS (
       SELECT contact."id" FROM "Contact" contact WHERE contact."workspaceId"=$1 AND contact."mergedIntoContactId" IS NULL
         AND (${contactScopeClause})
     ), base AS (
       SELECT contact."id",COALESCE(NULLIF(BTRIM(contact."displayName"),''),contact."primaryPhone") AS "name",
         LEFT(COALESCE(NULLIF(BTRIM(contact."displayName"),''),contact."primaryPhone"),1) AS "initials",contact."primaryPhone" AS "phone",
         ARRAY(SELECT identifier."normalizedValue" FROM "ContactIdentifier" identifier WHERE identifier."workspaceId"=$1 AND identifier."contactId"=contact."id" AND identifier."type"='PHONE' ORDER BY identifier."createdAt",identifier."id") AS "additionalPhones",
         COALESCE(latestMessage."textBody",CASE WHEN COALESCE(messageStats."messageCount",0)>0 THEN 'Attachment' ELSE 'No conversation yet' END) AS "preview",
         COALESCE(latestMessage."createdAt",contact."createdAt") AS "lastActivityAt",COALESCE(messageStats."messageCount",0)::int AS "messageCount",
         COALESCE(unreadStats."unreadCount",0)::int AS "unreadCount",COALESCE(latestConversation."state"::text,'OPEN') AS "state",
         latestConversation."assignedUserId",latestConversation."assignedTo",latestConversation."assignedTeamId",latestConversation."assignedTeam",
         COALESCE(conversationStats."conversationAssignments",'[]'::jsonb) AS "conversationAssignments",
         COALESCE(conversationStats."channelNumberIds",ARRAY[]::text[]) AS "channelNumberIds",
         latestConversation."channelNumberId" AS "currentSenderNumberId",latestMessage."channelNumberId" AS "latestMessageSenderNumberId",
         latestInbound."id" AS "latestInboundMessageId",latestInbound."createdAt" AS "latestInboundMessageAt",
         COALESCE(failureStats."hasFailed",FALSE) AS "hasFailed",contact."tags",
         queueStats."unansweredSince",
         (SELECT string_agg(number."label"||' '||number."e164Number",' ') FROM "ChannelNumber" number WHERE number."workspaceId"=$1 AND number."id"=ANY(COALESCE(conversationStats."channelNumberIds",ARRAY[]::text[]))) AS "numberText"
       FROM visible_contacts visible JOIN "Contact" contact ON contact."id"=visible."id"
       LEFT JOIN LATERAL (
         SELECT c."state",c."assignedUserId",u."name" AS "assignedTo",c."assignedTeamId",t."name" AS "assignedTeam",c."channelNumberId"
         FROM visible_conversations c LEFT JOIN "User" u ON u."id"=c."assignedUserId" LEFT JOIN "Team" t ON t."id"=c."assignedTeamId"
         WHERE c."contactId"=contact."id" ORDER BY c."lastMessageAt" DESC,c."updatedAt" DESC LIMIT 1
       ) latestConversation ON TRUE
       LEFT JOIN LATERAL (SELECT SUM(c."unreadCount")::int AS "unreadCount" FROM visible_conversations c WHERE c."contactId"=contact."id") unreadStats ON TRUE
       LEFT JOIN LATERAL (
         SELECT jsonb_agg(jsonb_build_object('channelNumberId',c."channelNumberId",'assignedTeamId',c."assignedTeamId",'assignedUserId',c."assignedUserId",'state',c."state",'unreadCount',c."unreadCount",'serviceWindowExpiresAt',c."serviceWindowExpiresAt")) AS "conversationAssignments",
           array_agg(DISTINCT c."channelNumberId") AS "channelNumberIds"
         FROM visible_conversations c WHERE c."contactId"=contact."id"
       ) conversationStats ON TRUE
       LEFT JOIN LATERAL (
         SELECT message."textBody",message."createdAt",message."channelNumberId" FROM "Message" message
         WHERE message."workspaceId"=$1 AND message."contactId"=contact."id" AND message."direction"<>'INTERNAL'
           AND (${messageScopeClause})
         ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1
       ) latestMessage ON TRUE
       LEFT JOIN LATERAL (
         SELECT message."id",message."createdAt" FROM "Message" message
         WHERE message."workspaceId"=$1 AND message."contactId"=contact."id" AND message."direction"='INBOUND'
           AND (${messageScopeClause})
         ORDER BY message."createdAt" DESC,message."id" DESC LIMIT 1
       ) latestInbound ON TRUE
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS "messageCount" FROM "Message" message WHERE message."workspaceId"=$1 AND message."contactId"=contact."id" AND message."direction"<>'INTERNAL'
           AND (${messageScopeClause})
       ) messageStats ON TRUE
       LEFT JOIN LATERAL (
         SELECT EXISTS(SELECT 1 FROM "Message" message WHERE message."workspaceId"=$1 AND message."contactId"=contact."id" AND message."status"='FAILED'
           AND (${messageScopeClause})) AS "hasFailed"
       ) failureStats ON TRUE
       LEFT JOIN LATERAL (
         SELECT MIN(waiting."lastInboundAt") AS "unansweredSince" FROM (
           SELECT message."channelNumberId",MAX(message."createdAt") FILTER (WHERE message."direction"='INBOUND') AS "lastInboundAt",
             MAX(message."createdAt") FILTER (WHERE message."direction"='OUTBOUND' AND message."status" IN ('SENT','DELIVERED','READ')) AS "lastOutboundAt"
           FROM "Message" message WHERE message."workspaceId"=$1 AND message."contactId"=contact."id"
             AND (${messageScopeClause})
           GROUP BY message."channelNumberId"
         ) waiting WHERE waiting."lastInboundAt" IS NOT NULL AND (waiting."lastOutboundAt" IS NULL OR waiting."lastInboundAt">waiting."lastOutboundAt")
       ) queueStats ON TRUE
     )
     SELECT b.*,(${matchesExpression}) AS "matchesFilter" FROM base b ORDER BY b."lastActivityAt" DESC,b."id"`,
    params,
  );
  const chats = result.rows.map((row, index) => {
    const lastActivity = new Date(row.lastActivityAt);
    const now = new Date();
    const time = Number.isNaN(lastActivity.getTime()) ? "" : lastActivity.toDateString() === now.toDateString()
      ? lastActivity.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })
      : lastActivity.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const tags = row.tags ?? [];
    const status = row.state === "WAITING" ? "Waiting" as const : row.state === "RESOLVED" ? "Resolved" as const : "Open" as const;
    const rowName = row.name;
    return {
      id: row.id, name: rowName, initials: rowName.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("") || row.initials,
      phone: row.phone, additionalPhones: [...new Set((row.additionalPhones ?? []).filter((phone) => phone !== row.phone))], preview: row.preview,
      time, color: ["bg-rose-100 text-rose-700", "bg-violet-100 text-violet-700", "bg-amber-100 text-amber-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-orange-100 text-orange-700"][index % 6],
      unread: Number(row.unreadCount) || undefined, state: status, assignedTo: row.assignedTo ?? undefined, assignedUserId: row.assignedUserId ?? undefined,
      assignedTeamId: row.assignedTeamId ?? undefined, assignedTeam: row.assignedTeam ?? undefined, conversationAssignments: (row.conversationAssignments ?? []).map((thread) => ({ ...thread, state: thread.state === "WAITING" ? "Waiting" as const : thread.state === "RESOLVED" ? "Resolved" as const : "Open" as const, unreadCount: Number(thread.unreadCount ?? 0) })),
      channelNumberIds: row.channelNumberIds ?? [], currentSenderNumberId: row.currentSenderNumberId ?? undefined, latestMessageSenderNumberId: row.latestMessageSenderNumberId ?? undefined,
      latestInboundMessageId: row.latestInboundMessageId ?? undefined, latestInboundMessageAt: row.latestInboundMessageAt ? new Date(row.latestInboundMessageAt).toISOString() : undefined,
      messageCount: Number(row.messageCount), hasFailed: row.hasFailed, unansweredSince: row.unansweredSince ? new Date(row.unansweredSince).toISOString() : undefined,
      tags, label: tags[0], matchesFilter: row.matchesFilter, messages: [] as never[],
    };
  });
  return { ...metadata, chats };
}
