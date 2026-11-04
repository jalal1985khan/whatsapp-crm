"use client";

import { SelectControl } from "@/components/ui/select-control";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Archive, ArrowRightLeft, ArrowUpRight, AtSign, Bell, Check, CheckCheck,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Filter, Inbox,
  Info, MessageCircle, MoreHorizontal, Paperclip, Plus, Search, Send,
  Settings2, ShieldCheck, Smile, Sparkles, Users, Wifi, X,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Message, MessageAvatar, MessageContent, MessageFooter } from "@/components/ui/message";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";

type Chat = {
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
  conversationAssignments?: { channelNumberId: string; assignedTeamId?: string; assignedUserId?: string; state?: "Open" | "Waiting" | "Resolved"; unreadCount?: number; serviceWindowExpiresAt?: string | null }[];
  channelNumberIds?: string[];
  eligibleSenderNumberIds?: string[];
  currentSenderNumberId?: string;
  latestMessageSenderNumberId?: string;
  detailLoaded?: boolean;
  matchesFilter?: boolean;
  messageCount?: number;
  hasFailed?: boolean;
  unansweredSince?: string;
  label?: string;
  tags?: string[];
  internalNotes?: { id: string; text: string; author: string; time: string; createdAt?: string }[];
  messagingConsent?: "unknown" | "opted_in" | "opted_out";
  consentSource?: string;
  consentUpdatedAt?: string;
  consentUpdatedBy?: string;
  consentHistory?: { id: string; status: "opted_in" | "opted_out"; source: string; wordingVersion?: string; updatedAt: string; updatedBy: string }[];
  color: string;
  messages: { id?: string; text: string; time: string; createdAt?: string; mine?: boolean; senderNumberId?: string; status?: "local" | "queued" | "sent" | "delivered" | "read" | "failed" | "unknown"; failureClass?: string; media?: { type: string; mimeType?: string; filename?: string; size?: number; caption?: string; mediaId?: string; stored?: boolean; storageStatus?: string; messageId?: string; accessUrl?: string } }[];
};

type SenderNumber = { id: string; label: string; number: string; state: string; allowedTeamIds?: string[] };
type TeamMember = { id: string; name: string; email: string; role: string };
type Team = { id: string; name: string; members: TeamMember[] };
type SyncedTemplate = { id: string; name: string; language: string; category: string; status: string; components: { type?: string; text?: string }[] };
type CannedReply = { id: string; title: string; shortcut: string | null; body: string };
type SavedInboxView = { id: string; name: string; query: string; activeTab: string; stateFilter: string; numberFilter: string; teamFilter: string; tagFilter: string; dateFrom: string; dateTo: string };

function InboxMessageRow({ chat, message, index, senderNumbers, canRetry, canPurge, sending, onRetry, onPurge }: {
  chat: Chat;
  message: Chat["messages"][number];
  index: number;
  senderNumbers: SenderNumber[];
  canRetry: boolean;
  canPurge: boolean;
  sending: boolean;
  onRetry: (messageId: string) => void;
  onPurge: (messageId: string) => void;
}) {
  const messageId = message.id ?? `${chat.id}-${index}`;
  return <MessageScrollerItem id={message.id ? `crm-message-${message.id}` : undefined} messageId={messageId} scrollAnchor={!message.mine}>
    <Message align={message.mine ? "end" : "start"}>
      {!message.mine && <MessageAvatar className="size-7"><Avatar className="size-7"><AvatarFallback className={`${chat.color} text-[9px]`}>{chat.initials}</AvatarFallback></Avatar></MessageAvatar>}
      <MessageContent className="w-auto max-w-[82%] flex-1 md:max-w-[70%]">
        <Bubble variant={message.mine ? "tinted" : "outline"} className="max-w-full rounded-2xl shadow-sm">
          <BubbleContent className="px-4 py-3">
            {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("image/") && <Image src={message.media.accessUrl} alt={message.media.filename || "WhatsApp image"} width={480} height={360} unoptimized className="mb-2 max-h-72 w-auto max-w-full rounded-lg object-contain" />}
            {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("video/") && <video controls preload="none" src={message.media.accessUrl} className="mb-2 max-h-72 max-w-full rounded-lg" />}
            {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("audio/") && <audio controls preload="none" src={message.media.accessUrl} className="mb-2 max-w-full" />}
            {message.media && <div className="mb-2 flex items-center gap-2 rounded-lg border bg-background/70 px-2.5 py-2"><Paperclip className="size-4 shrink-0" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{message.media.filename || `${message.media.type} attachment`}</p><p className="text-[10px] text-muted-foreground">{message.media.mimeType || message.media.type}{message.media.size ? ` · ${(message.media.size / (1024 * 1024)).toFixed(1)} MB` : ""}{message.media.stored ? " · archived securely" : message.media.storageStatus === "DELETED" ? " · file purged" : message.media.storageStatus === "QUARANTINED" ? " · quarantined by malware scan" : message.media.storageStatus === "FAILED" ? " · archive or scan failed; retry pending" : " · archiving or scanning"}</p></div>{message.media.stored && message.media.messageId && message.media.accessUrl && !/^(image|audio|video)\//.test(message.media.mimeType || "") && <a href={message.media.accessUrl} className="shrink-0 text-[10px] font-medium text-primary hover:underline">Download</a>}{canPurge && message.media.stored && message.media.messageId && <Button type="button" className="shrink-0 text-[10px] font-medium text-destructive hover:underline" onClick={() => onPurge(message.media!.messageId!)} variant="ghost">Purge</Button>}</div>}
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{message.media?.caption || message.text}</p>
          </BubbleContent>
        </Bubble>
        <MessageFooter className="mt-1 min-h-4 gap-1.5 px-1 text-[10px]">
          {message.mine && message.senderNumberId && <span>{senderNumbers.find((number) => number.id === message.senderNumberId)?.label ?? "WhatsApp"} ·</span>}
          <span>{message.time}</span>
          {message.mine && ["sent", "delivered", "read"].includes(message.status ?? "") && <span aria-label={message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : "Sent"} title={message.status === "read" ? "Read" : message.status === "delivered" ? "Delivered" : "Sent"}><CheckCheck className={`size-3.5 ${message.status === "read" ? "text-sky-600" : "text-slate-500"}`} /></span>}
          {message.mine && message.status === "failed" && <><span className="font-medium text-destructive" title={message.failureClass ? `Failure class: ${message.failureClass.replaceAll("_", " ").toLowerCase()}` : "WhatsApp rejected this message; cause is unknown and requires review."}>Failed{message.failureClass ? ` · ${message.failureClass.replaceAll("_", " ").toLowerCase()}` : ""}</span>{canRetry && (!message.media || message.media.type === "template") && message.id && message.failureClass !== "UNKNOWN_HOLD" && message.failureClass !== "OUTCOME_UNKNOWN" && <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-[10px]" disabled={sending} onClick={() => onRetry(message.id!)}>Retry</Button>}</>}
          {message.mine && message.status === "unknown" && <span className="font-medium text-amber-800" title="Check delivery status before retrying">Check status</span>}
          {message.mine && (message.status === "queued" || message.status === "local") && <span className="text-muted-foreground">{message.status === "local" ? "Local" : "Sending"}</span>}
        </MessageFooter>
      </MessageContent>
    </Message>
  </MessageScrollerItem>;
}

function eligibleSenders(chat: Chat | undefined, numbers: SenderNumber[]) {
  if (chat?.eligibleSenderNumberIds) {
    const eligibleIds = new Set(chat.eligibleSenderNumberIds);
    return numbers.filter((number) => number.state === "Active" && eligibleIds.has(number.id));
  }
  return numbers.filter((number) => {
    if (number.state !== "Active") return false;
    if (!number.allowedTeamIds?.length) return true;
    const existingThread = chat?.conversationAssignments?.find((thread) => thread.channelNumberId === number.id);
    const teamId = existingThread ? existingThread.assignedTeamId : chat?.assignedTeamId;
    return Boolean(teamId && number.allowedTeamIds.includes(teamId));
  });
}

function unansweredQueueAgeMinutes(chat: Chat) {
  if (chat.state === "Resolved") return null;
  if (chat.unansweredSince) return Math.max(0, Math.floor((Date.now() - new Date(chat.unansweredSince).getTime()) / 60_000));
  if (!chat.detailLoaded) return null;
  const threads = new Map<string, { inbound: number; outbound: number }>();
  for (const message of chat.messages) {
    if (!message.createdAt) continue;
    const createdAt = new Date(message.createdAt).getTime();
    if (!Number.isFinite(createdAt)) continue;
    const thread = threads.get(message.senderNumberId ?? "unknown-number") ?? { inbound: 0, outbound: 0 };
    if (!message.mine) thread.inbound = Math.max(thread.inbound, createdAt);
    else if (["sent", "delivered", "read"].includes(message.status ?? "")) thread.outbound = Math.max(thread.outbound, createdAt);
    threads.set(message.senderNumberId ?? "unknown-number", thread);
  }
  const waitingSince = [...threads.values()].filter((thread) => thread.inbound > thread.outbound).map((thread) => thread.inbound);
  return waitingSince.length ? Math.max(0, Math.floor((Date.now() - Math.min(...waitingSince)) / 60_000)) : null;
}

function formatQueueAge(minutes: number) {
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${Math.floor(minutes / 1440)}d ${Math.floor((minutes % 1440) / 60)}h`;
}

function QueueAgeBadge({ chat }: { chat: Chat }) {
  const age = unansweredQueueAgeMinutes(chat);
  return age === null ? null : <Badge variant={age >= 240 ? "warning" : "outline"} title="Age since the oldest unanswered customer message" className="mt-1 px-2 py-0 text-[10px]">Needs reply · {formatQueueAge(age)}</Badge>;
}

function templateBody(template?: SyncedTemplate) { return template?.components?.find((component) => component.type?.toUpperCase() === "BODY")?.text ?? ""; }
function templateVariables(body: string) {
  const tokens = [...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]);
  if (tokens.length && tokens.every((token) => /^\d+$/.test(token))) {
    const indexes = [...new Set(tokens.map(Number))].sort((left, right) => left - right);
    return indexes.every((value, index) => value === index + 1) ? indexes.map(String) : [];
  }
  if (tokens.length && tokens.every((token) => /^[a-z][a-z0-9_]*$/.test(token))) return [...new Set(tokens)];
  return [];
}

function IconButton({ label, children, className = "", onClick }: { label: string; children: React.ReactNode; className?: string; onClick?: () => void }) {
  return <Button type="button" aria-label={label} title={label} onClick={onClick} className={`inline-flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground ${className}`} variant="ghost">{children}</Button>;
}

type AdminAlert = { id: string; severity: "INFO" | "WARNING" | "CRITICAL"; category: string; title: string; message: string; targetType: string | null; targetId: string | null; createdAt: string; readAt: string | null };

export function InboxApp({ user, cannedReplies = [] }: { user: { id: string; name: string; email: string; role: string }; cannedReplies?: CannedReply[] }) {
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChatId, setLoadingChatId] = useState("");
  const [viewThread, setViewThread] = useState<{ contactId: string; numberId: string } | null>(null);
  const pendingMessageJumpId = useRef("");
  const [senderNumbers, setSenderNumbers] = useState<SenderNumber[]>([]);
  const [channelNumbers, setChannelNumbers] = useState<SenderNumber[]>([]);
  const [templates, setTemplates] = useState<SyncedTemplate[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [activeId, setActiveId] = useState("");
  const activeIdRef = useRef("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState("");
  const [savedReplyOpen, setSavedReplyOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState("");
  const attachmentPreviewUrl = useRef("");
  const [sending, setSending] = useState(false);
  const [composerMode, setComposerMode] = useState<"reply" | "note" | "template">("reply");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [templateParameters, setTemplateParameters] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("All messages");
  const [filterOpen, setFilterOpen] = useState(false);
  const [stateFilter, setStateFilter] = useState("All states");
  const [numberFilter, setNumberFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const inboxFiltersRef = useRef({ query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo });
  const senderNumbersRef = useRef(senderNumbers);
  const inboxListRequestRef = useRef(0);
  const filtersMountedRef = useRef(false);
  useEffect(() => { activeIdRef.current = activeId; }, [activeId]);
  useEffect(() => { inboxFiltersRef.current = { query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo }; }, [query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo]);
  useEffect(() => { senderNumbersRef.current = senderNumbers; }, [senderNumbers]);
  const [savedInboxViews, setSavedInboxViews] = useState<SavedInboxView[]>([]);
  const [savedInboxViewsPersistent, setSavedInboxViewsPersistent] = useState(false);
  const [savedInboxViewsBusy, setSavedInboxViewsBusy] = useState(false);
  const [saveViewOpen, setSaveViewOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState("");
  const [activeNumberId, setActiveNumberId] = useState<string | null>(null);
  const [rerouteTargetId, setRerouteTargetId] = useState("");
  const [rerouting, setRerouting] = useState(false);
  const [rerouteOpen, setRerouteOpen] = useState(false);
  const [numberMenu, setNumberMenu] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [showProfile, setShowProfile] = useState(true);
  const [timelineExpanded, setTimelineExpanded] = useState(false);
  const [notice, setNotice] = useState("");
  const [consentSourceDraft, setConsentSourceDraft] = useState("");
  const [windowCheckTime, setWindowCheckTime] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setWindowCheckTime(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const [consentWordingVersionDraft, setConsentWordingVersionDraft] = useState("");
  const [userMenu, setUserMenu] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const sendKeys = useRef(new Map<string, string>());
  const attachmentInput = useRef<HTMLInputElement>(null);
  const draftInputRef = useRef<HTMLTextAreaElement>(null);
  const adminCanPurgeMedia = user.role === "Owner" || user.role === "Admin";
  const adminCanRetryMessages = user.role === "Owner" || user.role === "Admin";
  const activeChat = chats.find((chat) => chat.id === activeId) ?? chats[0];
  const knownThreadNumberIds = activeChat?.channelNumberIds?.length
    ? activeChat.channelNumberIds
    : [...new Set((activeChat?.messages ?? []).map((message) => message.senderNumberId).filter((id): id is string => Boolean(id)))];
  const selectedSenderIsEligible = viewThread != null && viewThread.contactId === activeChat?.id
    && eligibleSenders(activeChat, senderNumbers).some((number) => number.id === viewThread.numberId);
  const activeThreadNumberIds = [...new Set([...knownThreadNumberIds, ...(selectedSenderIsEligible ? [viewThread!.numberId] : [])])];
  const defaultThreadNumberId = activeChat?.currentSenderNumberId
    ?? [...(activeChat?.messages ?? [])].reverse().find((message) => message.senderNumberId)?.senderNumberId
    ?? activeThreadNumberIds[0]
    ?? "";
  const viewedThreadNumberId = viewThread != null && viewThread.contactId === activeChat?.id && activeThreadNumberIds.includes(viewThread.numberId)
    ? viewThread.numberId
    : defaultThreadNumberId;
  const activeThreadAssignment = activeChat?.conversationAssignments?.find((thread) => thread.channelNumberId === viewedThreadNumberId);
  const activeThreadExists = Boolean(activeThreadAssignment) || Boolean(activeChat?.channelNumberIds?.includes(viewedThreadNumberId)) || Boolean(activeChat?.messages.some((message) => message.senderNumberId === viewedThreadNumberId));
  const activeThreadState = activeThreadAssignment?.state ?? (activeThreadExists ? activeChat?.state : undefined) ?? "Open";
  const activeThreadAssigneeId = activeThreadAssignment?.assignedUserId;
  const activeThreadTeamId = activeThreadAssignment?.assignedTeamId;
  const viewedThreadMessages = (activeChat?.messages ?? []).filter((message) => message.senderNumberId === viewedThreadNumberId);
  const customerTimeline = useMemo(() => {
    if (!activeChat) return [];
    const items: { key: string; timestamp: string; displayTime?: string; title: string; detail: string; senderNumberId?: string; messageId?: string }[] = [];
    activeChat.messages.forEach((message, index) => items.push({ key: `message-${message.id ?? index}`, timestamp: message.createdAt ?? "", displayTime: message.time, title: message.mine ? "Message sent" : "Message received", detail: message.text || (message.media ? `${message.media.type} attachment` : "Message"), senderNumberId: message.senderNumberId, messageId: message.id }));
    (activeChat.internalNotes ?? []).forEach((note) => items.push({ key: `note-${note.id}`, timestamp: note.createdAt ?? "", displayTime: note.time, title: `Internal note · ${note.author}`, detail: note.text }));
    (activeChat.consentHistory ?? []).forEach((record) => items.push({ key: `consent-${record.id}`, timestamp: record.updatedAt, title: `WhatsApp ${record.status === "opted_in" ? "opt-in" : "opt-out"} recorded`, detail: `${record.source} · ${record.updatedBy}` }));
    return items.sort((a, b) => {
      const left = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const right = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return right - left;
    });
  }, [activeChat]);
  useEffect(() => {
    if (!pendingMessageJumpId.current) return;
    const target = document.getElementById(`crm-message-${pendingMessageJumpId.current}`);
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    pendingMessageJumpId.current = "";
  }, [viewedThreadMessages]);
  const senderNumbersForChat = useMemo(() => eligibleSenders(activeChat, senderNumbers), [senderNumbers, activeChat]);
  const currentThreadNumberId = activeChat?.currentSenderNumberId ?? [...(activeChat?.messages ?? [])].reverse().find((message) => message.senderNumberId)?.senderNumberId;
  const activeNumber = senderNumbersForChat.find((number) => number.id === activeNumberId)
    ?? senderNumbersForChat.find((number) => number.id === currentThreadNumberId)
    ?? senderNumbersForChat[0]
    ?? null;
  const sendingThreadAssignment = activeChat?.conversationAssignments?.find((thread) => thread.channelNumberId === activeNumber?.id);
  const latestInboundForSender = activeChat?.messages.filter((message) => !message.mine && message.senderNumberId === activeNumber?.id).at(-1);
  const serviceWindowExpiresAt = sendingThreadAssignment?.serviceWindowExpiresAt !== undefined
    ? sendingThreadAssignment.serviceWindowExpiresAt
    : latestInboundForSender?.createdAt ? new Date(new Date(latestInboundForSender.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
  const serviceWindowOpen = Boolean(serviceWindowExpiresAt && new Date(serviceWindowExpiresAt).getTime() > windowCheckTime);
  const activeSenderEligible = Boolean(activeNumber && activeChat?.detailLoaded);
  const eligibleAssignees = activeThreadTeamId ? teams.find((team) => team.id === activeThreadTeamId)?.members ?? [] : teamMembers;
  const activeTags = activeChat?.tags ?? (activeChat?.label ? [activeChat.label] : []);
  const messageSenderIds = (activeChat?.messages ?? []).map((message) => message.senderNumberId).filter((id): id is string => Boolean(id));
  const latestMessageSenderId = messageSenderIds.at(-1);
  const currentRouteNumberId = viewedThreadNumberId || activeNumber?.id || activeChat?.currentSenderNumberId || latestMessageSenderId;
  const previousSenderId = viewedThreadMessages.length ? viewedThreadNumberId : latestMessageSenderId;
  const previousSender = previousSenderId ? channelNumbers.find((number) => number.id === previousSenderId) : undefined;
  const senderChanged = Boolean(activeNumber && previousSender && activeNumber.id !== previousSender.id);
  const consentStatus = activeChat?.messagingConsent ?? "unknown";
  const replyAllowed = consentStatus === "opted_in";
  const approvedTemplates = templates.filter((template) => template.status === "APPROVED");
  const selectedTemplate = approvedTemplates.find((template) => template.id === selectedTemplateId);
  const selectedTemplateBody = templateBody(selectedTemplate);
  const selectedTemplateVariables = templateVariables(selectedTemplateBody);
  const selectedTemplateParameterCount = selectedTemplateVariables.length;
  const selectedTemplatePreview = selectedTemplateBody.replace(/\{\{([^{}]+)\}\}/g, (_match, variable: string) => {
    const index = selectedTemplateVariables.indexOf(variable);
    return index >= 0 ? templateParameters[index]?.trim() || `{{${variable}}}` : `{{${variable}}}`;
  });
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const chat of chats) for (const tag of chat.tags ?? (chat.label ? [chat.label] : [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
  }, [chats]);
  const visibleChats = useMemo(() => chats.filter((chat) => chat.matchesFilter !== false), [chats]);
  const unreadCount = chats.reduce((sum, chat) => sum + (chat.unread ? 1 : 0), 0);

  useEffect(() => {
    let disposed = false;
    const storageKey = `relay-inbox-views:${user.id}`;
    const localViews: SavedInboxView[] = (() => {
      try {
      const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey) || "[]");
        return Array.isArray(parsed) ? parsed.filter((item): item is SavedInboxView => Boolean(item && typeof item.id === "string" && typeof item.name === "string" && typeof item.activeTab === "string")) : [];
      } catch { return []; }
    })();
    const localViewsTimer = window.setTimeout(() => { if (!disposed) setSavedInboxViews(localViews); }, 0);
    void (async () => {
      try {
        const response = await fetch("/api/inbox-views", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (!data.persistent || !Array.isArray(data.views) || disposed) return;
        let remoteViews = data.views as SavedInboxView[];
        for (const localView of localViews) {
          if (remoteViews.some((view) => view.name.toLowerCase() === localView.name.toLowerCase())) continue;
          const migrated = await fetch("/api/inbox-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: localView.name, filters: localView }) });
          if (!migrated.ok) continue;
          const created = await migrated.json();
          if (created.view) remoteViews = [...remoteViews, created.view];
        }
        if (disposed) return;
        setSavedInboxViews(remoteViews); setSavedInboxViewsPersistent(true);
      } catch { /* Keep browser storage available if the saved-view service cannot be reached. */ }
    })();
    return () => { disposed = true; window.clearTimeout(localViewsTimer); };
  }, [user.id]);

  async function saveInboxView() {
    const name = saveViewName.trim();
    if (!name || savedInboxViewsBusy) return;
    const view: SavedInboxView = { id: crypto.randomUUID(), name: name.slice(0, 40), query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo };
    if (savedInboxViews.some((saved) => saved.name.toLowerCase() === view.name.toLowerCase())) { setNotice("Choose a different name; you already have a view with that name."); return; }
    if (savedInboxViewsPersistent) {
      setSavedInboxViewsBusy(true);
      try {
        const response = await fetch("/api/inbox-views", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: view.name, filters: view }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not save this inbox view.");
        setSavedInboxViews((current) => [...current, data.view]);
      } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not save this inbox view."); return; }
      finally { setSavedInboxViewsBusy(false); }
    } else {
      const next = [...savedInboxViews, view]; setSavedInboxViews(next);
      try { window.localStorage.setItem(`relay-inbox-views:${user.id}`, JSON.stringify(next)); }
      catch { setNotice("Could not save this inbox view in this browser."); return; }
    }
    setSaveViewName(""); setSaveViewOpen(false); setNotice("Inbox view saved.");
  }

  async function deleteInboxView(view: SavedInboxView) {
    if (savedInboxViewsBusy) return;
    if (savedInboxViewsPersistent) {
      setSavedInboxViewsBusy(true);
      try {
        const response = await fetch(`/api/inbox-views?id=${encodeURIComponent(view.id)}`, { method: "DELETE" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not delete this inbox view.");
        setSavedInboxViews((current) => current.filter((item) => item.id !== view.id));
      } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not delete this inbox view."); }
      finally { setSavedInboxViewsBusy(false); }
    } else {
      const next = savedInboxViews.filter((item) => item.id !== view.id); setSavedInboxViews(next);
      try { window.localStorage.setItem(`relay-inbox-views:${user.id}`, JSON.stringify(next)); }
      catch { setNotice("Could not update saved inbox views in this browser."); }
    }
  }

  function applyInboxView(view: SavedInboxView) {
    setQuery(view.query ?? ""); setActiveTab(view.activeTab); setStateFilter(view.stateFilter ?? "All states"); setNumberFilter(view.numberFilter ?? ""); setTeamFilter(view.teamFilter ?? ""); setTagFilter(view.tagFilter ?? ""); setDateFrom(view.dateFrom ?? ""); setDateTo(view.dateTo ?? "");
  }

  function personalizedReply(reply: CannedReply) {
    return reply.body.replace(/\{\{customer_name\}\}/gi, activeChat?.name ?? "").replace(/\{\{agent_name\}\}/gi, user.name);
  }

  function insertSavedReply(reply: CannedReply) {
    const text = personalizedReply(reply);
    setDraft((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`);
    setSavedReplyOpen(false);
    setComposerMode("reply");
    window.setTimeout(() => draftInputRef.current?.focus(), 0);
  }

  useEffect(() => {
    function handleReplyShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.key.toLowerCase() !== "r") return;
      event.preventDefault(); setComposerMode("reply"); setSavedReplyOpen(true);
      window.setTimeout(() => draftInputRef.current?.focus(), 0);
    }
    window.addEventListener("keydown", handleReplyShortcut);
    return () => window.removeEventListener("keydown", handleReplyShortcut);
  }, []);

  function selectAttachment(file: File | null) {
    if (attachmentPreviewUrl.current) URL.revokeObjectURL(attachmentPreviewUrl.current);
    if (!file && attachmentInput.current) attachmentInput.current.value = "";
    const preview = file?.type.startsWith("image/") ? URL.createObjectURL(file) : "";
    attachmentPreviewUrl.current = preview;
    setAttachmentPreview(preview);
    setAttachment(file);
  }
  useEffect(() => () => {
    if (attachmentPreviewUrl.current) URL.revokeObjectURL(attachmentPreviewUrl.current);
  }, []);

  const refreshAlerts = useCallback(async () => {
    const response = await fetch("/api/admin/alerts", { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    if (Array.isArray(data.alerts)) setAlerts(data.alerts);
    setAlertCount(Number(data.unreadCount ?? 0));
  }, []);
  async function markAlertRead(alertId?: string) {
    await fetch("/api/admin/alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(alertId ? { id: alertId } : { markAllRead: true }) });
    await refreshAlerts();
  }
  useEffect(() => {
    if (user.role !== "Owner" && user.role !== "Admin") return;
    const initialTimer = window.setTimeout(() => void refreshAlerts(), 0);
    const timer = window.setInterval(() => void refreshAlerts(), 60_000);
    return () => { window.clearTimeout(initialTimer); window.clearInterval(timer); };
  }, [user.role, refreshAlerts]);

  async function updateConversation(chatId: string, action: "read" | "resolve" | "reopen" | "wait" | "assign" | "assign_team" | "add_tag" | "remove_tag", assignee?: string | null, tag?: string, teamId?: string | null, channelNumberId?: string) {
    const member = assignee ? teamMembers.find((item) => item.id === assignee || item.name === assignee) : null;
    const threadId = channelNumberId ?? (chatId === activeId ? viewedThreadNumberId : undefined);
    const response = await fetch(`/api/conversations/${chatId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, assignee: member?.name ?? null, assigneeId: member?.id ?? null, teamId, tag, ...(threadId ? { channelNumberId: threadId } : {}) }) });
    const data = await response.json();
    if (!response.ok) { setNotice(data.error || "Sign in before changing conversation status."); return; }
    setChats((current) => current.map((chat) => chat.id === chatId ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
    void refreshInboxList();
  }

  async function rerouteConversation() {
    if (!activeChat || !rerouteTargetId || rerouting) return;
    const destination = senderNumbersForChat.find((number) => number.id === rerouteTargetId);
    if (!destination) return;
    setRerouting(true);
    try {
      const response = await fetch(`/api/conversations/${encodeURIComponent(activeChat.id)}/reroute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceNumberId: currentRouteNumberId, targetNumberId: destination.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reroute conversation.");
      setActiveNumberId(destination.id);
      setViewThread({ contactId: activeChat.id, numberId: destination.id });
      setRerouteOpen(false);
      setNotice(`Future messages can use ${destination.label} (${destination.number}). Existing WhatsApp history remains in its original number thread.`);
      void refreshInboxList();
      router.refresh();
      window.setTimeout(() => setNotice(""), 6000);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not reroute conversation."); }
    finally { setRerouting(false); }
  }

  function beginReroute() {
    setRerouteTargetId(senderNumbersForChat.find((number) => number.id !== viewedThreadNumberId)?.id ?? "");
    setRerouteOpen(true);
  }

  const refreshChatDetail = useCallback(async (chatId: string, isDisposed: () => boolean = () => false) => {
    if (!chatId || isDisposed()) return;
    setLoadingChatId(chatId);
    try {
      const response = await fetch(`/api/crm?contact=${encodeURIComponent(chatId)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load this conversation.");
      const detail = Array.isArray(data.chats) ? data.chats.find((chat: Chat) => chat.id === chatId) as Chat | undefined : undefined;
      if (!detail || isDisposed()) return;
      setChats((items) => items.map((chat) => chat.id === chatId ? { ...chat, ...detail, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      if (activeIdRef.current === chatId) {
        const channelId = detail.currentSenderNumberId ?? [...detail.messages].reverse().find((message) => message.senderNumberId)?.senderNumberId;
        const eligibleForChat = eligibleSenders(detail, senderNumbersRef.current);
        setActiveNumberId((selected) => eligibleForChat.find((number) => number.id === selected)?.id ?? eligibleForChat.find((number) => number.id === channelId)?.id ?? eligibleForChat[0]?.id ?? null);
      }
    } catch (cause) {
      if (!isDisposed()) setNotice(cause instanceof Error ? cause.message : "Could not load this conversation.");
    } finally {
      setLoadingChatId((current) => current === chatId ? "" : current);
    }
  }, []);

  const buildInboxListUrl = useCallback(() => {
    const filters = inboxFiltersRef.current;
    const params = new URLSearchParams({ list: "1", q: filters.query, tab: filters.activeTab, state: filters.stateFilter, number: filters.numberFilter, team: filters.teamFilter, tag: filters.tagFilter, dateFrom: filters.dateFrom, dateTo: filters.dateTo });
    return `/api/crm?${params.toString()}`;
  }, []);

  const refreshInboxList = useCallback(async (isDisposed: () => boolean = () => false) => {
    const requestId = ++inboxListRequestRef.current;
    const response = await fetch(buildInboxListUrl(), { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load CRM data.");
    if (isDisposed() || requestId !== inboxListRequestRef.current) return;
    const loadedChats: Chat[] = Array.isArray(data.chats) ? data.chats : [];
    const allNumbers: SenderNumber[] = Array.isArray(data.numbers) ? data.numbers : [];
    const requestedContact = new URLSearchParams(window.location.search).get("contact");
    const currentStillVisible = loadedChats.some((chat) => chat.id === activeIdRef.current);
    const selectedId = currentStillVisible ? activeIdRef.current : loadedChats.find((chat) => chat.id === requestedContact)?.id || loadedChats[0]?.id || "";
    setChats((current) => loadedChats.map((summary) => {
      const previous = current.find((chat) => chat.id === summary.id);
      return previous?.detailLoaded && previous.id === selectedId
        ? { ...previous, ...summary, messages: previous.messages, internalNotes: previous.internalNotes, consentHistory: previous.consentHistory, detailLoaded: true }
        : { ...summary, messages: [], detailLoaded: false };
    }));
    setSenderNumbers(allNumbers.filter((item) => item.state === "Active"));
    setChannelNumbers(allNumbers);
    if (Array.isArray(data.team)) setTeamMembers(data.team);
    if (selectedId !== activeIdRef.current) { activeIdRef.current = selectedId; setActiveId(selectedId); }
    if (selectedId) void refreshChatDetail(selectedId, isDisposed);
  }, [buildInboxListUrl, refreshChatDetail]);

  function openChat(chat: Chat) {
    setSavedReplyOpen(false);
    activeIdRef.current = chat.id;
    setActiveId(chat.id);
    const channelId = chat.currentSenderNumberId ?? [...chat.messages].reverse().find((message) => message.senderNumberId)?.senderNumberId;
    const selectedThreadId = channelId ?? chat.channelNumberIds?.[0];
    const eligibleForChat = eligibleSenders(chat, senderNumbers);
    const channel = eligibleForChat.find((number) => number.id === channelId && number.state === "Active");
    setActiveNumberId((channel ?? eligibleForChat[0])?.id ?? null);
    if (!chat.detailLoaded) void refreshChatDetail(chat.id);
    const selectedUnread = chat.conversationAssignments?.find((thread) => thread.channelNumberId === selectedThreadId)?.unreadCount ?? chat.unread;
    if (selectedUnread && selectedThreadId) void updateConversation(chat.id, "read", undefined, undefined, undefined, selectedThreadId);
  }

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let refreshing = false;
    const isHidden = () => document.visibilityState === "hidden";
    const refresh = async () => {
      if (disposed || refreshing || isHidden()) return;
      refreshing = true;
      try {
        await refreshInboxList(() => disposed);
      } catch {
        if (!disposed) setNotice("Could not refresh CRM data. Check the database connection and retry.");
      } finally {
        refreshing = false;
        if (!disposed && !isHidden()) timer = window.setTimeout(() => void refresh(), 5000);
      }
    };
    const handleVisibilityChange = () => {
      if (isHidden()) {
        if (timer) window.clearTimeout(timer);
        timer = undefined;
      } else {
        if (timer) window.clearTimeout(timer);
        timer = undefined;
        void refresh();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void refresh();
    return () => { disposed = true; document.removeEventListener("visibilitychange", handleVisibilityChange); if (timer) window.clearTimeout(timer); };
  }, [refreshInboxList]);

  useEffect(() => {
    if (!filtersMountedRef.current) { filtersMountedRef.current = true; return; }
    let disposed = false;
    const timer = window.setTimeout(() => {
      void refreshInboxList(() => disposed).catch((cause) => setNotice(cause instanceof Error ? cause.message : "Could not refresh the inbox results."));
    }, 250);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [query, activeTab, stateFilter, numberFilter, teamFilter, tagFilter, dateFrom, dateTo, refreshInboxList]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/teams", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (!disposed && Array.isArray(data.teams)) setTeams(data.teams);
    }).catch(() => undefined);
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const loadTemplates = async () => {
      try {
        const response = await fetch("/api/templates", { cache: "no-store" });
        const data = await response.json();
        if (!disposed && response.ok && Array.isArray(data.templates)) setTemplates(data.templates);
      } catch { /* Template access is optional when Meta is not connected. */ }
      finally { if (!disposed) timer = window.setTimeout(() => void loadTemplates(), 60_000); }
    };
    void loadTemplates();
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, []);

  async function sendMessage() {
    if ((!draft.trim() && !attachment) || !activeNumber || !activeSenderEligible || !activeChat?.detailLoaded || sending) return;
    const text = draft.trim();
    const draftKey = JSON.stringify([activeId, activeNumber.id, text, attachment?.name, attachment?.size, attachment?.lastModified]);
    const idempotencyKey = sendKeys.current.get(draftKey) ?? crypto.randomUUID();
    sendKeys.current.set(draftKey, idempotencyKey);
    setSending(true);
    try {
      let response: Response;
      if (attachment) {
        const form = new FormData(); form.set("chatId", activeId); form.set("senderNumberId", activeNumber.id); form.set("caption", text); form.set("idempotencyKey", idempotencyKey); form.set("file", attachment);
        response = await fetch("/api/messages", { method: "POST", body: form });
      } else response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: activeId, text, senderNumberId: activeNumber.id, idempotencyKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save message.");
      sendKeys.current.delete(draftKey);
      if (data.chat) setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      else if (data.message) setChats((current) => current.map((chat) => {
        if (chat.id !== activeId) return chat;
        const messages = chat.messages.some((message) => message.id && message.id === data.message.id) ? chat.messages : [...chat.messages, data.message];
        return { ...chat, preview: data.message.text || (data.message.media ? `${data.message.media.type} attachment` : text), time: data.message.time || new Date().toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }), messages };
      }));
      setDraft(""); selectAttachment(null);
      setNotice(attachment ? "Attachment accepted by WhatsApp · delivery status will update from Meta." : data.failedOver ? `WhatsApp accepted the message from ${senderNumbers.find((number) => number.id === data.message?.senderNumberId)?.label ?? "the backup number"}.${data.transitionNoticeSent ? " A number-change notice was also sent to the customer." : " The customer was not notified; please tell them the number changed."} The original number needs admin review.` : data.delivery === "whatsapp" ? "Accepted by WhatsApp · delivery status will update from Meta." : "Saved in CRM · WhatsApp delivery is not connected yet.");
      window.setTimeout(() => setNotice(""), 3600);
    } catch (cause) {
      if (!(cause instanceof Error) || (!cause.message.toLowerCase().includes("unknown") && !cause.message.toLowerCase().includes("check its status"))) sendKeys.current.delete(draftKey);
      setNotice(cause instanceof Error ? cause.message : "Could not save message.");
    } finally { setSending(false); }
  }

  async function purgeAttachment(messageId: string) {
    if (!window.confirm("Permanently remove this archived file from the CRM? The message and attachment metadata will remain in the conversation.")) return;
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}/media`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not purge archived media.");
      setNotice("Archived attachment purged. Message history and attachment metadata were retained.");
      const refresh = await fetch(`/api/crm?contact=${encodeURIComponent(activeId)}`, { cache: "no-store" });
      const snapshot = await refresh.json();
      const refreshedChat = refresh.ok && Array.isArray(snapshot.chats) ? snapshot.chats.find((chat: Chat) => chat.id === activeId) : null;
      if (refreshedChat) setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, ...refreshedChat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not purge archived media."); }
  }

  async function retryFailedMessage(messageId: string) {
    if (!activeNumber || !activeSenderEligible) { setNotice("Choose an active sender number allowed by this conversation’s routing rules first."); return; }
    if (!window.confirm("Create one new send from this confirmed failed message? The CRM will recheck consent, number eligibility, routing, and current WhatsApp rules.")) return;
    setSending(true);
    try {
      const response = await fetch(`/api/messages/${encodeURIComponent(messageId)}/retry`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ senderNumberId: activeNumber.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retry this message.");
      if (data.chat) setChats((current) => current.map((chat) => chat.id === data.chat.id ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      else {
        const refreshed = await fetch(`/api/crm?contact=${encodeURIComponent(activeId)}`, { cache: "no-store" });
        const snapshot = await refreshed.json();
        const refreshedChat = refreshed.ok && Array.isArray(snapshot.chats) ? snapshot.chats.find((chat: Chat) => chat.id === activeId) : null;
        if (refreshedChat) setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, ...refreshedChat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      }
      setNotice(data.retry?.needsReview ? "The prior retry did not finish recording its outcome. Check the message status before sending again." : data.retry?.duplicate ? "This failed message already has a retry attempt." : `A new message was sent from ${activeNumber.label}; delivery status will update from Meta.`);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not retry this message."); }
    finally { setSending(false); }
  }

  async function sendTemplateMessage() {
    if (!selectedTemplate || !activeNumber || !activeSenderEligible || !activeChat?.detailLoaded || !replyAllowed || templateParameters.length !== selectedTemplateParameterCount || templateParameters.some((value) => !value.trim())) return;
    const draftKey = JSON.stringify([activeId, activeNumber.id, "template", selectedTemplate.id, templateParameters]);
    const idempotencyKey = sendKeys.current.get(draftKey) ?? crypto.randomUUID();
    sendKeys.current.set(draftKey, idempotencyKey);
    try {
      const namedParameters = selectedTemplateVariables.some((variable) => !/^\d+$/.test(variable));
      const response = await fetch("/api/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chatId: activeId, senderNumberId: activeNumber.id, type: "template", templateId: selectedTemplate.id, parameters: templateParameters, ...(namedParameters ? { parameterNames: selectedTemplateVariables } : {}), idempotencyKey }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send approved template.");
      sendKeys.current.delete(draftKey);
      if (data.chat) setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      setTemplateParameters([]);
      setNotice(data.failedOver ? `WhatsApp accepted the template from ${senderNumbers.find((number) => number.id === data.message?.senderNumberId)?.label ?? "the backup number"}.${data.transitionNoticeSent ? " A number-change notice was also sent to the customer." : " The customer was not notified; please tell them the number changed."} The original number needs admin review.` : "Template accepted by WhatsApp · delivery status will update from Meta.");
      window.setTimeout(() => setNotice(""), 3600);
    } catch (cause) {
      if (!(cause instanceof Error) || (!cause.message.toLowerCase().includes("unknown") && !cause.message.toLowerCase().includes("check its status"))) sendKeys.current.delete(draftKey);
      setNotice(cause instanceof Error ? cause.message : "Could not send approved template.");
    }
  }

  async function saveInternalNote() {
    if (!draft.trim() || !activeChat?.detailLoaded) return;
    try {
      const response = await fetch(`/api/conversations/${activeId}/notes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: draft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save note.");
      setChats((current) => current.map((chat) => chat.id === activeId ? { ...chat, internalNotes: data.chat.internalNotes } : chat));
      setDraft("");
      setNotice("Internal note saved for your team only.");
      window.setTimeout(() => setNotice(""), 3200);
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not save note."); }
  }

  async function updateConsent(status: "opted_in" | "opted_out") {
    if (!activeChat?.detailLoaded) return;
    if (!consentSourceDraft.trim()) { setNotice("Add where or how the customer gave consent before saving."); return; }
    if (!consentWordingVersionDraft.trim()) { setNotice("Add the consent wording version before saving."); return; }
    try {
      const response = await fetch(`/api/contacts/${activeChat.id}/consent`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status, source: consentSourceDraft, wordingVersion: consentWordingVersionDraft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update consent.");
      setChats((current) => current.map((chat) => chat.id === activeChat.id ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      setConsentSourceDraft("");
      setNotice(status === "opted_in" ? "Customer opt-in recorded." : "Customer opt-out recorded. WhatsApp replies are blocked.");
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Could not update consent."); }
  }

  async function updateTag(tag: string, action: "add_tag" | "remove_tag") {
    if (!activeChat) return;
    await updateConversation(activeChat.id, action, undefined, tag);
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (!activeChat) return <main className="flex min-h-screen flex-col bg-[#f7f8f6] text-slate-900">
    <header className="flex h-[68px] items-center justify-between border-b bg-white px-5"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><MessageCircle className="size-4" /></div><span className="text-sm font-semibold">Relay CRM</span></div><div className="flex items-center gap-2">{adminCanPurgeMedia && <Link href="/admin/numbers"><Button variant="outline" size="sm"><AtSign data-icon="inline-start" />Manage numbers</Button></Link>}<Link href="/customers?new=1"><Button size="sm"><Plus data-icon="inline-start" />Add customer</Button></Link></div></header>
    <section className="m-auto flex max-w-lg flex-col items-center px-6 py-16 text-center"><div className="flex size-14 items-center justify-center rounded-2xl bg-[#eaf3ed] text-primary"><Inbox className="size-7" /></div><h1 className="mt-5 text-xl font-semibold">Your inbox is ready</h1><p className="mt-2 text-sm leading-relaxed text-muted-foreground">Add a customer or connect an approved sender number to start building your shared conversation history.</p><div className="mt-6 flex flex-wrap justify-center gap-3"><Link href="/customers?new=1"><Button><Plus data-icon="inline-start" />Add customer</Button></Link>{adminCanPurgeMedia && <Link href="/admin/numbers"><Button variant="outline"><AtSign data-icon="inline-start" />Manage numbers ({senderNumbers.length} active)</Button></Link>}</div>{notice && <p role="status" className="mt-5 text-xs text-amber-800">{notice}</p>}</section>
  </main>;

  return (
    <main className="flex h-screen min-h-[650px] overflow-hidden bg-white text-slate-900">
      <aside className="hidden w-[72px] shrink-0 flex-col items-center border-r bg-[#fafbfa] py-4 sm:flex">
        <div className="mb-8 flex size-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm"><MessageCircle className="size-5" /></div>
        <div className="flex flex-1 flex-col gap-2">
          <RailLink href="/" active label="Inbox"><Inbox /></RailLink>
          <RailLink href="/customers" label="Customers"><Users /></RailLink>
          {adminCanPurgeMedia && <><RailLink href="/admin/numbers" label="Numbers"><AtSign /></RailLink><RailLink href="/reports" label="Reports"><ArrowUpRight /></RailLink></>}
        </div>
          <div className="flex flex-col gap-2">
          <RailButton label="Help" onClick={() => setHelpOpen(true)}><CircleHelp /></RailButton>
          {adminCanPurgeMedia && <Link href="/admin/numbers" aria-label="Admin settings" title="Admin settings" className="flex size-10 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-muted hover:text-slate-900"><Settings2 /></Link>}
          <div className="relative mt-2"><Button onClick={() => setUserMenu((open) => !open)} aria-label="Open account menu" title={user.name} className="rounded-full" type="button" variant="ghost"><Avatar className="size-9 border"><AvatarFallback className="bg-[#e4eee8] text-xs text-[#315d47]">{user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</AvatarFallback></Avatar></Button>{userMenu && <div className="absolute bottom-0 left-12 z-30 w-56 rounded-xl border bg-white p-2 shadow-lg"><div className="px-2 py-2"><div className="truncate text-xs font-semibold">{user.name}</div><div className="truncate text-[10px] text-muted-foreground">{user.email}</div><div className="mt-1 text-[10px] text-primary">{user.role}</div></div><Separator className="my-1" /><Link href="/account/security" onClick={() => setUserMenu(false)} className="block rounded-lg px-2 py-2 text-xs hover:bg-muted">Account security</Link>{adminCanPurgeMedia && <Link href="/admin/numbers" onClick={() => setUserMenu(false)} className="block rounded-lg px-2 py-2 text-xs hover:bg-muted">Workspace administration</Link>}<Button onClick={() => void signOut()} className="w-full rounded-lg px-2 py-2 text-left text-xs text-red-700 hover:bg-red-50" type="button" variant="ghost">Sign out</Button></div>}</div>
        </div>
      </aside>

      <section className="flex w-full min-w-[300px] max-w-[370px] shrink-0 flex-col border-r md:w-[330px]">
        <div className="flex h-[68px] items-center justify-between border-b px-5">
          <div><div className="text-[15px] font-semibold">Inbox</div><div className="text-xs text-muted-foreground">Customer conversations</div></div>
          <div className="flex items-center gap-1">{(user.role === "Owner" || user.role === "Admin") && <div className="relative"><IconButton label={`Admin alerts${alertCount ? `, ${alertCount} unread` : ""}`} onClick={() => { setAlertsOpen((open) => !open); void refreshAlerts(); }}><Bell className="size-[18px]" />{alertCount > 0 && <span className="absolute right-0.5 top-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-semibold leading-4 text-white">{alertCount > 99 ? "99+" : alertCount}</span>}</IconButton>{alertsOpen && <section aria-label="Admin alerts" className="absolute right-0 top-11 z-40 w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-white shadow-xl"><div className="flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-sm font-semibold">Admin alerts</h2><p className="text-[10px] text-muted-foreground">Number, delivery, webhook, and failover events</p></div><Button variant="ghost" size="sm" disabled={!alertCount} onClick={() => void markAlertRead()}>Mark all read</Button></div><div className="max-h-[60vh] overflow-y-auto">{alerts.map((alert) => { const params = new URLSearchParams(); if (alert.targetId && alert.targetType === "CHANNEL_NUMBER") params.set("number", alert.targetId); if (alert.targetId && alert.targetType === "WHATSAPP_BUSINESS_ACCOUNT") params.set("waba", alert.targetId); const numberTarget = params.size > 0 ? `/admin/numbers?${params.toString()}` : "/admin/numbers"; const href = alert.targetType === "WEBHOOK_EVENT" ? "/admin/webhooks" : alert.targetType === "CHANNEL_NUMBER" || alert.targetType === "WHATSAPP_BUSINESS_ACCOUNT" || alert.targetType === "FAILOVER_EVENT" ? numberTarget : alert.targetType === "CONTACT" && alert.targetId ? `/?contact=${encodeURIComponent(alert.targetId)}` : "/admin/numbers"; return <Link href={href} key={alert.id} onClick={() => { setAlertsOpen(false); if (!alert.readAt) void markAlertRead(alert.id); }} className={`block border-b px-4 py-3 hover:bg-muted/50 ${alert.readAt ? "bg-white" : "bg-amber-50/50"}`}><div className="flex items-start justify-between gap-2"><p className="text-xs font-semibold">{alert.title}</p><Badge variant={alert.severity === "CRITICAL" ? "warning" : alert.severity === "WARNING" ? "outline" : "secondary"}>{alert.severity === "CRITICAL" ? "Urgent" : alert.severity === "WARNING" ? "Review" : "Info"}</Badge></div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{alert.message}</p><p className="mt-2 text-[10px] text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</p></Link>; })}{alerts.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">No alerts yet. Critical WhatsApp events will appear here.</p>}</div></section>}</div>}<Link href="/customers?new=1" aria-label="Add customer" title="Add customer" className="inline-flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"><Plus /></Link></div>
        </div>
        <div className="p-4 pb-3">
          <div className="relative"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search conversations" className="h-10 rounded-lg bg-[#fafbfa] pl-9" /></div>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto px-4 pb-3">
          {["All messages", "Mine", "Unassigned", "Team", "Unread", "Failed"].map((tab) => <Button key={tab} onClick={() => setActiveTab(tab)} className={`shrink-0 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors ${activeTab === tab ? "bg-[#eaf3ed] text-[#285b40]" : "text-muted-foreground hover:bg-muted"}`} type="button" variant="ghost">{tab}{tab === "Unread" && <span className="ml-1.5 text-[10px]">{unreadCount}</span>}</Button>)}
          <IconButton label="Filter conversations" className="ml-auto shrink-0" onClick={() => setFilterOpen((open) => !open)}><Filter className="size-4" /></IconButton>
        </div>
        {savedInboxViews.length > 0 && <div aria-label="Saved inbox views" className="flex gap-1.5 overflow-x-auto px-4 pb-3">{savedInboxViews.map((view) => <div key={view.id} className="flex shrink-0 items-center rounded-full border bg-white"><Button type="button" size="sm" variant="ghost" className="h-7 rounded-r-none px-2.5 text-[10px]" onClick={() => applyInboxView(view)}>{view.name}</Button><Button type="button" size="icon" variant="ghost" aria-label={`Delete saved view ${view.name}`} title={`Delete ${view.name}`} className="size-7 rounded-l-none text-muted-foreground" disabled={savedInboxViewsBusy} onClick={() => void deleteInboxView(view)}><X /></Button></div>)}</div>}
        {filterOpen && <div className="grid grid-cols-2 gap-2 px-4 pb-3"><SelectControl aria-label="Filter by conversation status" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="h-8 min-w-0 rounded-md border bg-white px-2 text-[11px]"><option>All states</option><option>Open</option><option>Waiting</option><option>Resolved</option></SelectControl><SelectControl aria-label="Filter by WhatsApp number" value={numberFilter} onChange={(event) => setNumberFilter(event.target.value)} className="h-8 min-w-0 rounded-md border bg-white px-2 text-[11px]"><option value="">All numbers</option>{channelNumbers.map((number) => <option key={number.id} value={number.id}>{number.label} · {number.number}</option>)}</SelectControl><SelectControl aria-label="Filter by team" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="h-8 min-w-0 rounded-md border bg-white px-2 text-[11px]"><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectControl><SelectControl aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="h-8 min-w-0 rounded-md border bg-white px-2 text-[11px]"><option value="">All tags</option>{[...new Set([...availableTags, ...chats.flatMap((chat) => chat.tags ?? (chat.label ? [chat.label] : []))])].sort().map((tag) => <option key={tag} value={tag}>{tag}</option>)}</SelectControl><label className="flex h-8 items-center gap-1 text-[10px] text-muted-foreground">From<Input aria-label="Messages on or after date" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-8 min-w-0 px-1 text-[10px]" /></label><label className="flex h-8 items-center gap-1 text-[10px] text-muted-foreground">To<Input aria-label="Messages on or before date" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-8 min-w-0 px-1 text-[10px]" /></label><Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => { setStateFilter("All states"); setNumberFilter(""); setTeamFilter(""); setTagFilter(""); setDateFrom(""); setDateTo(""); setActiveTab("All messages"); }}>Clear filters</Button><Button type="button" size="sm" variant="outline" className="h-8 text-[11px]" onClick={() => setSaveViewOpen((open) => !open)}>Save current view</Button>{saveViewOpen && <div className="col-span-2 flex gap-2"><Input aria-label="Saved view name" maxLength={40} placeholder="Name this view" value={saveViewName} onChange={(event) => setSaveViewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); saveInboxView(); } }} className="h-8 text-xs" /><Button type="button" size="sm" className="h-8" disabled={savedInboxViewsBusy || !saveViewName.trim()} onClick={() => void saveInboxView()}>{savedInboxViewsBusy ? "Saving…" : "Save"}</Button></div>}</div>}
        <div className="flex-1 overflow-y-auto">
          {visibleChats.map((chat) => <Button key={chat.id} onClick={() => openChat(chat)} className={`flex w-full items-start gap-3 border-b px-4 py-4 text-left transition-colors hover:bg-[#fafbfa] ${activeId === chat.id ? "bg-[#f1f6f2]" : "bg-white"}`} type="button" variant="ghost">
            <Avatar className="size-10 shrink-0"><AvatarFallback className={`${chat.color} text-xs`}>{chat.initials}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1"><div className="mb-1 flex items-center justify-between gap-2"><span className="truncate text-[13px] font-semibold">{chat.name}</span><span className="shrink-0 text-[10px] text-muted-foreground">{chat.time}</span></div><div className="flex items-center justify-between gap-2"><p className="truncate text-xs text-muted-foreground">{chat.preview}</p>{chat.unread && <span className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-white">{chat.unread}</span>}</div><div className="mt-1 flex min-w-0 items-center gap-1.5">{chat.assignedTo && <span className="max-w-[90px] truncate text-[10px] text-muted-foreground">{chat.assignedTo}</span>}<span className="text-[10px] text-muted-foreground">· {chat.state ?? "Open"}</span>{chat.messageCount ? <span className="ml-auto max-w-[110px] truncate text-[10px] text-muted-foreground">{channelNumbers.find((number) => number.id === chat.latestMessageSenderNumberId)?.label ?? "WhatsApp"}</span> : null}</div><QueueAgeBadge chat={chat} />{(chat.tags ?? (chat.label ? [chat.label] : [])).slice(0, 2).map((tag) => <Badge key={tag} variant="secondary" className="mr-1 mt-1 px-2 py-0.5 text-[10px] font-medium">{tag}</Badge>)}</div>
          </Button>)}
          {visibleChats.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No conversations match your search.</div>}
        </div>
        <div className="border-t p-4"><Link href="/admin/numbers" className="flex items-center gap-2 rounded-lg bg-[#f7f9f7] p-3 hover:bg-[#eef4ef]"><div className="flex size-8 items-center justify-center rounded-full bg-white text-primary"><Wifi className="size-4" /></div><div className="min-w-0 flex-1"><div className="text-xs font-semibold">{senderNumbers.length} active numbers</div><div className="text-[10px] text-muted-foreground">Manage sender numbers</div></div><ChevronRight className="size-4 text-muted-foreground" /></Link></div>
      </section>

      <section className="flex min-w-0 flex-1 flex-col bg-[#f7f8f6]">
        <header className="flex h-[68px] items-center justify-between border-b bg-white px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-3"><Avatar className="size-10"><AvatarFallback className={`${activeChat.color} text-xs`}>{activeChat.initials}</AvatarFallback></Avatar><div className="min-w-0"><div className="flex items-center gap-2"><h1 className="truncate text-sm font-semibold">{activeChat.name}</h1><Badge variant="outline" className="hidden text-[10px] sm:inline-flex">{activeThreadState}</Badge></div><p className="text-xs text-muted-foreground">{activeChat.phone}</p>{activeThreadNumberIds.length > 1 && <label className="mt-1 flex items-center gap-1 text-[9px] text-muted-foreground"><span>Viewing thread</span><SelectControl aria-label="View conversation thread by WhatsApp number" value={viewedThreadNumberId} onChange={(event) => { const numberId = event.target.value; setViewThread({ contactId: activeChat.id, numberId }); if (senderNumbersForChat.some((number) => number.id === numberId)) setActiveNumberId(numberId); }} className="h-6 max-w-[170px] rounded border bg-white px-1 text-[10px] text-foreground">{activeThreadNumberIds.map((numberId) => { const number = channelNumbers.find((item) => item.id === numberId); return <option key={numberId} value={numberId}>{number?.label ?? "WhatsApp number"} · {number?.number ?? numberId}</option>; })}</SelectControl></label>}</div></div>
          <div className="flex items-center gap-1">
            {user.role !== "Agent" && <Button type="button" variant="outline" size="sm" disabled={senderNumbersForChat.length < 2} onClick={beginReroute} className="mr-1 h-8 px-2 text-[11px]"><ArrowRightLeft data-icon="inline-start" />Reroute</Button>}
            <div className="relative">
              <Button disabled={!senderNumbersForChat.length} onClick={() => setNumberMenu((open) => !open)} className="mr-2 flex h-9 items-center gap-2 rounded-lg border bg-white px-3 text-left transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60" type="button" variant="ghost"><span className={`size-2 rounded-full ${activeNumber ? "bg-emerald-500" : "bg-slate-300"}`} /><span className="hidden text-xs sm:block"><span className="font-medium">{activeNumber?.label ?? "No active number"}</span>{activeNumber && <span className="ml-2 text-muted-foreground">{activeNumber.number}</span>}</span>{senderNumbers.length > 0 && <ChevronDown className="size-3.5 text-muted-foreground" />}</Button>
              {numberMenu && <div className="absolute right-2 top-11 z-20 w-64 rounded-xl border bg-white p-1.5 shadow-lg">{senderNumbersForChat.length ? senderNumbersForChat.map((number) => <Button key={number.id} onClick={() => { setActiveNumberId(number.id); setViewThread({ contactId: activeChat.id, numberId: number.id }); setNumberMenu(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-muted" type="button" variant="ghost"><span className="size-2 rounded-full bg-emerald-500" /><span className="min-w-0 flex-1"><span className="block text-xs font-medium">{number.label}</span><span className="block text-[10px] text-muted-foreground">{number.number}</span></span>{activeNumber?.id === number.id && <Check className="size-4 text-primary" />}</Button>) : <p className="px-2.5 py-3 text-xs text-muted-foreground">No active number is available for this conversation’s team.</p>}{(user.role === "Owner" || user.role === "Admin") && <><Separator className="my-1" /><Link href="/admin/numbers" className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-medium text-primary hover:bg-muted"><Plus className="size-4" />Manage numbers</Link></>}</div>}
            </div>
            <IconButton label="Conversation details" className="hidden md:inline-flex" ><Info className="size-[18px]" /></IconButton><IconButton label="More options"><MoreHorizontal className="size-[18px]" /></IconButton>
          </div>
        </header>

        {notice && <div role="status" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-5 py-2 text-xs text-amber-900"><Info className="size-4 shrink-0" />{notice}<Button onClick={() => setNotice("")} className="ml-auto" type="button" variant="ghost"><X className="size-4" /></Button></div>}
        <Marker role="status" className="justify-center py-4"><MarkerIcon><ShieldCheck /></MarkerIcon><MarkerContent className="text-[10px]">Messages are stored in your CRM timeline</MarkerContent></Marker>
        <MessageScrollerProvider autoScroll defaultScrollPosition="end">
          <MessageScroller className="flex-1">
            <MessageScrollerViewport aria-label={`Conversation with ${activeChat.name}`} className="px-4 pb-6 md:px-8">
              <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            {!activeChat.detailLoaded && <Marker role="status" className="w-fit max-w-full self-center rounded-full border bg-background px-3 py-1.5 text-[10px]"><MarkerContent>{loadingChatId === activeId ? "Loading conversation history…" : "Conversation history is not loaded yet."}</MarkerContent></Marker>}
            {senderChanged && previousSender && activeNumber && <Marker role="status" variant="border" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"><MarkerIcon className="self-start"><Info /></MarkerIcon><MarkerContent className="flex w-full flex-col items-start gap-1.5"><span className="text-xs font-semibold">This conversation is using a different WhatsApp number</span><span className="text-xs leading-relaxed">Earlier messages used {previousSender.label} ({previousSender.number}). New messages will come from {activeNumber.label} ({activeNumber.number}). WhatsApp does not transfer replies between numbers; the customer may need to message the new number to continue there.</span><Button type="button" size="sm" variant="outline" className="mt-1 h-8 border-amber-400 bg-background text-[11px] text-amber-950 hover:bg-amber-100" onClick={() => { setComposerMode("note"); selectAttachment(null); setDraft(`Reminder: let ${activeChat.name} know our WhatsApp number changed from ${previousSender.number} to ${activeNumber.number}. They may need to message the new number to continue the conversation.`); setNotice("Team-only reminder drafted. Save it as an internal note."); }}>Draft team reminder</Button></MarkerContent></Marker>}
            <Marker variant="separator" className="my-2"><MarkerContent>Today</MarkerContent></Marker>
            {activeThreadNumberIds.length > 1 && <Marker role="status" className="mx-auto w-fit rounded-full border bg-background px-3 py-1"><MarkerContent className="text-[10px]">Showing this number’s WhatsApp thread. Other number threads remain in the customer timeline.</MarkerContent></Marker>}
            {viewedThreadMessages.map((message, index) => <InboxMessageRow key={message.id ?? `${activeChat.id}-${index}`} chat={activeChat} message={message} index={index} senderNumbers={channelNumbers} canRetry={adminCanRetryMessages} canPurge={adminCanPurgeMedia} sending={sending} onRetry={(messageId) => void retryFailedMessage(messageId)} onPurge={(messageId) => void purgeAttachment(messageId)} />)}
            {viewedThreadMessages.length === 0 && <Marker role="status" className="mx-auto w-fit rounded-full border bg-background px-3 py-1.5"><MarkerContent>No messages in this WhatsApp number thread yet. You can start it with an approved template.</MarkerContent></Marker>}
            {activeChat.internalNotes?.map((note) => <Marker role="note" key={note.id} className="mx-auto w-full max-w-xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-950"><MarkerContent className="flex w-full flex-col gap-1"><span className="flex items-center justify-between gap-3"><span className="text-[10px] font-semibold uppercase tracking-wide">Internal note · Team only</span><span className="text-[10px]">{note.author} · {note.time}</span></span><span className="whitespace-pre-wrap text-xs leading-relaxed">{note.text}</span></MarkerContent></Marker>)}
            {composerMode !== "note" && activeNumber && <Marker role="status" className="mt-2 justify-center"><MarkerContent className="rounded-full bg-background/80 px-3 py-1 text-[10px]">Sending from {activeNumber.number}</MarkerContent></Marker>}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton aria-label="Jump to latest message" />
          </MessageScroller>
        </MessageScrollerProvider>
        <div className="px-4 pb-4 md:px-8 md:pb-6">
          <div className={`mx-auto max-w-3xl rounded-2xl border p-2 shadow-sm focus-within:ring-2 ${composerMode === "note" ? "border-amber-300 bg-amber-50 focus-within:ring-amber-200" : "bg-white focus-within:ring-primary/20"}`}>
            {!replyAllowed && composerMode !== "note" && <div className="mx-2 mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">{consentStatus === "opted_out" ? "Customer opted out. WhatsApp messages are blocked." : "Consent is not recorded. Record customer opt-in in the customer details to enable sending."}</div>}
            {replyAllowed && !activeNumber && composerMode !== "note" && <div className="mx-2 mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-900">There is no active sender number. Ask an administrator to add and approve one.</div>}
            {composerMode === "reply" && <input ref={attachmentInput} type="file" hidden accept="image/jpeg,image/png,video/mp4,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx" onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)} />}
            {composerMode === "reply" && attachment && <div className="mx-2 mt-2 flex items-center gap-3 rounded-lg border bg-slate-50 p-2">{attachmentPreview ? <Image src={attachmentPreview} alt="Attachment preview" width={56} height={56} unoptimized className="size-14 rounded-md object-cover" /> : <div className="flex size-14 items-center justify-center rounded-md bg-white"><Paperclip className="size-5 text-primary" /></div>}<div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{attachment.name}</p><p className="text-[10px] text-muted-foreground">{(attachment.size / (1024 * 1024)).toFixed(1)} MB · preview ready</p></div><Button type="button" aria-label="Remove attachment" onClick={() => { selectAttachment(null); if (attachmentInput.current) attachmentInput.current.value = ""; }} className="rounded-md p-1 text-muted-foreground hover:bg-white" variant="ghost"><X className="size-4" /></Button></div>}
            {composerMode === "template" ? <div className="grid gap-2 p-2">
              <label className="flex flex-col gap-1 text-[11px] font-medium">Approved template<SelectControl value={selectedTemplateId} onChange={(event) => { const id = event.target.value; setSelectedTemplateId(id); const item = approvedTemplates.find((template) => template.id === id); setTemplateParameters(Array.from({ length: templateVariables(templateBody(item)).length }, () => "")); }} className="h-9 rounded-lg border bg-white px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Choose a synced template</option>{approvedTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</SelectControl></label>
              {selectedTemplate && selectedTemplateParameterCount > 0 && <div className="grid gap-2 sm:grid-cols-2">{templateParameters.map((value, index) => { const variable = selectedTemplateVariables[index]; return <label key={`${selectedTemplate.id}-${variable}`} className="flex flex-col gap-1 text-[11px] font-medium">Value for {`{{${variable}}}`}<Input value={value} maxLength={1024} onChange={(event) => setTemplateParameters((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} placeholder={`Text value for ${variable}`} /></label>; })}</div>}
              {selectedTemplate && <div className="rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-700"><p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Preview · {selectedTemplate.category}</p>{selectedTemplatePreview || "No text body preview available"}</div>}
              {!approvedTemplates.length && <p className="text-xs text-muted-foreground">No approved templates are synced. Ask an administrator to sync them in Admin → Templates.</p>}
            </div> : <Textarea ref={draftInputRef} value={draft} onChange={(event) => setDraft(event.target.value)} disabled={!activeChat.detailLoaded || (composerMode === "reply" && (!replyAllowed || !activeNumber || !activeSenderEligible))} onKeyDown={(event) => { if (composerMode === "reply" && (event.key === " " || event.key === "Tab")) { const match = /(?:^|\s);([a-z0-9_-]{1,24})$/i.exec(draft); const reply = match ? cannedReplies.find((item) => item.shortcut?.toLowerCase() === match[1].toLowerCase()) : undefined; if (match && reply) { event.preventDefault(); const prefix = draft.slice(0, draft.length - match[0].length); setDraft(`${prefix}${prefix && !/\s$/.test(prefix) ? " " : ""}${personalizedReply(reply)}${event.key === " " ? " " : ""}`); setSavedReplyOpen(false); return; } } if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); if (composerMode === "note") void saveInternalNote(); else void sendMessage(); } }} placeholder={composerMode === "note" ? "Write a private note for your team..." : !activeNumber ? "No active sender number is available for this team" : replyAllowed ? "Write a message..." : "Replies disabled until opt-in is recorded"} rows={2} className="max-h-32 min-h-14 w-full resize-y border-0 bg-transparent px-3 py-2 text-[13px] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50" />}
            {savedReplyOpen && <div className="mx-2 mb-2 max-h-56 overflow-y-auto rounded-lg border bg-white p-2 shadow-sm"><div className="flex items-center justify-between px-2 pb-1"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saved replies</p><kbd className="rounded border px-1 py-0.5 text-[9px] text-muted-foreground">⌘/Ctrl ⇧ R</kbd></div>{cannedReplies.length ? <div className="flex flex-col">{cannedReplies.map((reply) => <Button type="button" key={reply.id} onClick={() => insertSavedReply(reply)} className="rounded-md px-2 py-2 text-left hover:bg-muted" variant="ghost"><span className="flex items-center justify-between gap-2 text-xs font-medium">{reply.title}{reply.shortcut && <span className="text-[10px] font-normal text-muted-foreground">;{reply.shortcut}</span>}</span><span className="mt-1 block truncate text-[10px] text-muted-foreground">{personalizedReply(reply)}</span></Button>)}</div> : <p className="px-2 py-3 text-xs text-muted-foreground">No active saved replies have been created.</p>}{(user.role === "Owner" || user.role === "Admin") && <Link href="/admin/replies" onClick={() => setSavedReplyOpen(false)} className="mt-1 block border-t px-2 pt-2 text-[10px] font-medium text-primary hover:underline">Manage saved replies</Link>}</div>}
            {emojiOpen && composerMode === "reply" && <div aria-label="Choose an emoji" className="mb-2 flex flex-wrap gap-1 rounded-lg border bg-white p-2 shadow-sm">{["😀", "😊", "👍", "❤️", "🎉", "🙏", "✅", "👋", "🙂", "🤔", "✨", "💬"].map((emoji) => <Button key={emoji} type="button" aria-label={`Insert ${emoji}`} variant="ghost" className="size-9 p-0 text-lg" onClick={() => { setDraft((current) => `${current}${emoji}`); setEmojiOpen(false); draftInputRef.current?.focus(); }}>{emoji}</Button>)}</div>}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 px-1 pt-2"><div className="flex items-center gap-1"><Button type="button" size="sm" variant={composerMode === "reply" ? "secondary" : "ghost"} onClick={() => setComposerMode("reply")} className="h-7 px-2 text-[11px]">Reply</Button><Button type="button" size="sm" variant={composerMode === "template" ? "secondary" : "ghost"} onClick={() => { setSavedReplyOpen(false); setEmojiOpen(false); selectAttachment(null); setComposerMode("template"); }} className="h-7 px-2 text-[11px]">Template</Button><Button type="button" size="sm" variant={composerMode === "note" ? "secondary" : "ghost"} onClick={() => { setSavedReplyOpen(false); setEmojiOpen(false); selectAttachment(null); setComposerMode("note"); }} className="h-7 px-2 text-[11px]">Internal note</Button>{composerMode === "reply" && replyAllowed && activeNumber && <span className="ml-2 hidden items-center gap-1 text-[10px] sm:flex"><Clock3 className="size-3" />{serviceWindowOpen ? `Free text window open${serviceWindowExpiresAt ? ` until ${new Date(serviceWindowExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}` : "Window closed · use an approved template"}</span>}{composerMode === "reply" && replyAllowed && activeNumber && <><IconButton label="Attach file" onClick={() => attachmentInput.current?.click()}><Paperclip className="size-[17px]" /></IconButton><IconButton label="Add emoji" onClick={() => setEmojiOpen((open) => !open)}><Smile className="size-[17px]" /></IconButton><IconButton label="Insert saved reply" onClick={() => { setEmojiOpen(false); setSavedReplyOpen((open) => !open); }}><Sparkles className="size-[17px]" /></IconButton></>}</div><Button size="sm" disabled={sending || !activeChat.detailLoaded || (composerMode === "note" ? !draft.trim() : composerMode === "template" ? (!selectedTemplate || !replyAllowed || !activeNumber || !activeSenderEligible || templateParameters.length !== selectedTemplateParameterCount || templateParameters.some((value) => !value.trim())) : (!draft.trim() && !attachment) || !replyAllowed || !activeNumber || !activeSenderEligible || !serviceWindowOpen)} onClick={() => composerMode === "note" ? void saveInternalNote() : composerMode === "template" ? void sendTemplateMessage() : void sendMessage()} className={`rounded-lg px-3 ${composerMode === "note" ? "bg-amber-700 text-white hover:bg-amber-800" : ""}`}>{sending ? "Uploading…" : composerMode === "note" ? "Save note" : <><Send data-icon="inline-start" />{composerMode === "template" ? "Send template" : attachment ? "Send attachment" : "Send"}</>}</Button></div>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-[10px] text-muted-foreground">{composerMode === "note" ? "Internal notes are only visible to your team and are not sent to WhatsApp" : composerMode === "template" ? "Templates can start a new WhatsApp conversation when the customer has opted in" : serviceWindowOpen ? `Free-form replies are available on ${activeNumber?.number} until ${serviceWindowExpiresAt ? new Date(serviceWindowExpiresAt).toLocaleString() : "the window closes"}` : "This number’s 24-hour customer-service window is closed. Use an approved template to start or resume messaging."}</p>
        </div>
      </section>

      {showProfile && <aside className="hidden w-[285px] shrink-0 flex-col border-l bg-white xl:flex">
        <div className="flex h-[68px] items-center justify-between border-b px-5"><span className="text-sm font-semibold">Customer details</span><Button onClick={() => setShowProfile(false)} aria-label="Close customer details" className="rounded-md p-1 text-muted-foreground hover:bg-muted" type="button" variant="ghost"><X className="size-4" /></Button></div>
        <div className="flex flex-col items-center border-b px-5 py-6"><Avatar className="size-16"><AvatarFallback className={`${activeChat.color} text-lg`}>{activeChat.initials}</AvatarFallback></Avatar><h2 className="mt-3 text-sm font-semibold">{activeChat.name}</h2><p className="mt-1 text-xs text-muted-foreground">{activeChat.phone}</p><div className="mt-4 flex flex-wrap justify-center gap-2"><SelectControl aria-label="Assign conversation to a team member" disabled={!activeThreadExists} value={activeThreadAssigneeId ?? ""} onChange={(event) => void updateConversation(activeChat.id, "assign", event.target.value || null, undefined, undefined, viewedThreadNumberId)} className="h-8 max-w-[145px] rounded-md border bg-white px-2 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Unassigned</option>{eligibleAssignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</SelectControl>{activeThreadState !== "Resolved" && <Button variant="outline" size="sm" disabled={!activeThreadExists} className="h-8 text-xs" onClick={() => void updateConversation(activeChat.id, activeThreadState === "Waiting" ? "reopen" : "wait", undefined, undefined, undefined, viewedThreadNumberId)}><Clock3 data-icon="inline-start" />{activeThreadState === "Waiting" ? "Reopen" : "Waiting"}</Button>}<Button variant="outline" size="sm" disabled={!activeThreadExists} className="h-8 text-xs" onClick={() => void updateConversation(activeChat.id, activeThreadState === "Resolved" ? "reopen" : "resolve", undefined, undefined, undefined, viewedThreadNumberId)}><Archive data-icon="inline-start" />{activeThreadState === "Resolved" ? "Reopen" : "Resolve"}</Button></div></div>
        <div className="border-b p-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Conversation</h3><Button className="text-muted-foreground" type="button" variant="ghost"><MoreHorizontal className="size-4" /></Button></div><div className="flex flex-col gap-3"><ProfileRow label="Status" value={activeThreadState} dot={activeThreadState === "Resolved" ? "bg-slate-400" : "bg-emerald-500"} />{!activeThreadExists && <p className="text-[10px] text-muted-foreground">Send an approved template to start this number-specific thread before assigning or changing its status.</p>}<div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">Assigned to</span><SelectControl aria-label="Assign conversation" disabled={!activeThreadExists} value={activeThreadAssigneeId ?? ""} onChange={(event) => void updateConversation(activeChat.id, "assign", event.target.value || null, undefined, undefined, viewedThreadNumberId)} className="max-w-[145px] rounded-md border bg-white px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Unassigned</option>{eligibleAssignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</SelectControl></div><div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">Team</span><SelectControl aria-label="Assign conversation to a team" disabled={!activeThreadExists} value={activeThreadTeamId ?? ""} onChange={(event) => void updateConversation(activeChat.id, "assign_team", undefined, undefined, event.target.value || null, viewedThreadNumberId)} className="max-w-[145px] rounded-md border bg-white px-2 py-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">No team</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectControl></div><ProfileRow label="Channel" value="WhatsApp" /><ProfileRow label="Number" value={channelNumbers.find((number) => number.id === viewedThreadNumberId)?.label ?? activeNumber?.label ?? "No active number"} /><ProfileRow label="Email" value={activeChat.email ?? "Not provided"} /><ProfileRow label="Source" value={activeChat.source ?? "Not recorded"} /><ProfileRow label="Owner" value={activeChat.ownerName ?? "Unassigned"} />{activeChat.additionalPhones?.map((phone) => <ProfileRow key={phone} label="Other phone" value={phone} />)}{Object.entries(activeChat.customFields ?? {}).map(([key, value]) => <ProfileRow key={key} label={key} value={String(value ?? "—")} />)}<ProfileRow label="Created" value={activeChat.createdAt ? new Date(activeChat.createdAt).toLocaleDateString() : "—"} /><ProfileRow label="Updated" value={activeChat.updatedAt ? new Date(activeChat.updatedAt).toLocaleDateString() : "—"} /></div></div>
        <div className="border-b p-5"><h3 className="mb-3 text-xs font-semibold">WhatsApp consent</h3><div className="flex items-center justify-between gap-2"><span className="text-[11px] text-muted-foreground">Status</span><Badge variant="outline" className={consentStatus === "opted_in" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : consentStatus === "opted_out" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}>{consentStatus === "opted_in" ? "Opted in" : consentStatus === "opted_out" ? "Opted out" : "Not recorded"}</Badge></div>{activeChat.consentSource && <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">Latest: {activeChat.consentSource}<br />Recorded by {activeChat.consentUpdatedBy ?? "team"}{activeChat.consentUpdatedAt ? ` · ${new Date(activeChat.consentUpdatedAt).toLocaleDateString()}` : ""}</p>}<Input value={consentSourceDraft} onChange={(event) => setConsentSourceDraft(event.target.value)} placeholder="Evidence/source (required)" className="mt-3 h-8 text-[11px]" /><Input value={consentWordingVersionDraft} onChange={(event) => setConsentWordingVersionDraft(event.target.value)} placeholder="Consent wording version (required)" className="mt-2 h-8 text-[11px]" /><p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">Record a form, message, or customer request as evidence.</p><div className="mt-2 grid grid-cols-2 gap-2"><Button variant="outline" size="sm" className="h-8 text-[10px]" onClick={() => void updateConsent("opted_in")}>Record opt-in</Button><Button variant="outline" size="sm" className="h-8 border-red-200 text-[10px] text-red-700 hover:bg-red-50" onClick={() => void updateConsent("opted_out")}>Record opt-out</Button></div>{activeChat.consentHistory && activeChat.consentHistory.length > 0 && <div className="mt-3 border-t pt-3"><p className="mb-2 text-[10px] font-medium text-muted-foreground">Consent history</p><div className="flex flex-col gap-2">{[...activeChat.consentHistory].reverse().map((record) => <div key={record.id} className="text-[10px] leading-relaxed"><span className={record.status === "opted_in" ? "font-medium text-emerald-800" : "font-medium text-red-800"}>{record.status === "opted_in" ? "Opt-in" : "Opt-out"}</span><span className="text-muted-foreground"> · {new Date(record.updatedAt).toLocaleString()} · {record.updatedBy}</span><p className="text-muted-foreground">{record.source}{record.wordingVersion ? ` · wording ${record.wordingVersion}` : ""}</p></div>)}</div></div>}</div>
        <div className="border-b p-5"><div className="mb-3 flex items-center justify-between"><h3 className="text-xs font-semibold">Tags</h3><Button aria-label="Add a tag" onClick={() => setTagMenu((open) => !open)} className="rounded-md p-1 text-primary hover:bg-muted" type="button" variant="ghost"><Plus className="size-4" /></Button></div><div className="flex flex-wrap gap-2">{activeTags.map((tag) => <Badge key={tag} variant="secondary" className="gap-1 bg-[#f2f3f5] text-slate-700">{tag}<Button aria-label={`Remove ${tag} tag`} onClick={() => void updateTag(tag, "remove_tag")} className="rounded-full text-slate-500 hover:text-red-700" type="button" variant="ghost">×</Button></Badge>)}{activeTags.length === 0 && <span className="text-[11px] text-muted-foreground">No tags added</span>}</div>{tagMenu && <div className="mt-3 flex flex-col gap-2 rounded-lg border bg-white p-2"><form onSubmit={(event) => { event.preventDefault(); const tag = newTag.trim(); if (!tag || activeTags.includes(tag)) return; setNewTag(""); setTagMenu(false); void updateTag(tag, "add_tag"); }} className="flex gap-1.5"><Input aria-label="New tag" value={newTag} maxLength={32} onChange={(event) => setNewTag(event.target.value)} placeholder="Type a tag" className="h-7 text-[11px]" /><Button type="submit" size="sm" disabled={!newTag.trim()} className="h-7 px-2 text-[10px]">Add</Button></form><div className="flex flex-wrap gap-1.5">{availableTags.filter((tag) => !activeTags.includes(tag)).map((tag) => <Button key={tag} onClick={() => { setTagMenu(false); void updateTag(tag, "add_tag"); }} className="rounded-full border px-2 py-1 text-[10px] hover:bg-muted" type="button" variant="ghost">+ {tag}</Button>)}{availableTags.every((tag) => activeTags.includes(tag)) && <span className="px-1 py-1 text-[10px] text-muted-foreground">{availableTags.length ? "All tags used in this inbox are applied." : "No tags in use yet. Type one above."}</span>}</div></div>}</div>
        <div className="p-5"><div className="mb-3 flex items-center justify-between"><Button type="button" variant="ghost" aria-expanded={timelineExpanded} onClick={() => setTimelineExpanded((expanded) => !expanded)} className="h-auto gap-1.5 p-0 text-xs font-semibold hover:bg-transparent">Customer timeline<ChevronDown className={`size-3.5 transition-transform ${timelineExpanded ? "rotate-180" : ""}`} /></Button><span className="text-[10px] text-muted-foreground">Across numbers</span></div>{timelineExpanded && <div><div className="mb-3 flex flex-wrap gap-1.5">{[...new Set(activeChat.messages.map((message) => message.senderNumberId).filter((id): id is string => Boolean(id)))].map((numberId) => { const number = channelNumbers.find((item) => item.id === numberId); const count = activeChat.messages.filter((message) => message.senderNumberId === numberId).length; return <Badge key={numberId} variant="outline" className="max-w-full truncate text-[9px]">{number?.label ?? "WhatsApp number"} · {count}</Badge>; })}</div><div className="max-h-80 space-y-3 overflow-y-auto pr-1">{customerTimeline.length ? customerTimeline.map((item) => { const number = item.senderNumberId ? channelNumbers.find((entry) => entry.id === item.senderNumberId) : undefined; const when = item.timestamp ? new Date(item.timestamp).toLocaleString() : item.displayTime ?? "Time unavailable"; return <div key={item.key} className="flex gap-2.5"><span className={`mt-1.5 size-2 shrink-0 rounded-full ${item.title.startsWith("Internal note") ? "bg-amber-500" : item.title.includes("opt-") ? "bg-violet-500" : "bg-primary"}`} /><div className="min-w-0 flex-1 border-b pb-2"><p className="text-[10px] font-semibold">{item.title}{number && <span className="font-normal text-muted-foreground"> · {number.label}</span>}</p><p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{when}{number ? ` · ${number.number}` : ""}</p>{item.messageId ? <Button type="button" onClick={() => { if (item.senderNumberId) { setViewThread({ contactId: activeChat.id, numberId: item.senderNumberId }); if (senderNumbersForChat.some((sender) => sender.id === item.senderNumberId)) setActiveNumberId(item.senderNumberId); } pendingMessageJumpId.current = item.messageId!; }} className="mt-1 block w-full truncate text-left text-[10px] text-foreground hover:text-primary" variant="ghost">{item.detail}</Button> : <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-foreground">{item.detail}</p>}</div></div>; }) : <p className="text-[11px] text-muted-foreground">No messages or CRM activity yet.</p>}</div></div>}</div>
      </aside>}
      <Dialog open={rerouteOpen} onOpenChange={(open) => { if (!rerouting) setRerouteOpen(open); }}><DialogContent><DialogHeader><DialogTitle>Reroute conversation</DialogTitle><DialogDescription>Choose the WhatsApp number for the new conversation thread. Existing messages stay under their original number; WhatsApp does not transfer chat history between numbers.</DialogDescription></DialogHeader>{activeChat && <><div className="rounded-lg border bg-muted/40 p-3 text-xs"><p className="text-muted-foreground">Current thread</p><p className="mt-1 font-medium">{channelNumbers.find((number) => number.id === currentRouteNumberId)?.label ?? "WhatsApp"} · {channelNumbers.find((number) => number.id === currentRouteNumberId)?.number ?? "—"}</p></div><label className="flex flex-col gap-1.5 text-xs font-medium">Customer-facing sender<SelectControl value={rerouteTargetId} onChange={(event) => setRerouteTargetId(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Choose a number</option>{senderNumbersForChat.filter((number) => number.id !== currentRouteNumberId).map((number) => <option key={number.id} value={number.id}>{number.label} · {number.number}</option>)}</SelectControl></label>{rerouteTargetId && <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs leading-relaxed text-amber-950">Future WhatsApp messages will use {senderNumbers.find((number) => number.id === rerouteTargetId)?.label} ({senderNumbers.find((number) => number.id === rerouteTargetId)?.number}). This opens or reuses a separate number-specific thread. The customer may need to message this number to continue.</div>}</>}<DialogFooter><Button variant="outline" disabled={rerouting} onClick={() => setRerouteOpen(false)}>Cancel</Button><Button disabled={rerouting || !rerouteTargetId} onClick={() => void rerouteConversation()}>{rerouting ? "Rerouting…" : "Confirm reroute"}</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}><DialogContent><DialogHeader><DialogTitle>Inbox help</DialogTitle><DialogDescription>Quick guide to working with WhatsApp conversations in Relay CRM.</DialogDescription></DialogHeader><div className="space-y-4 text-sm"><section><h3 className="font-medium">Replying to customers</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose an active sender number, confirm the customer has recorded WhatsApp opt-in, and use free-form replies only while the service window is open. Use an approved template when a template is required.</p></section><section><h3 className="font-medium">Changing the sender number</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">The CRM keeps all number-specific threads in the customer’s shared history. WhatsApp does not move a conversation between numbers, so the customer may need to message the new number to continue there.</p></section><section><h3 className="font-medium">Delivery status</h3><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Sent, delivered, read, and failed statuses come from WhatsApp. If the outcome is uncertain, check webhook health before trying again to avoid duplicate messages.</p></section><DialogFooter className="gap-2 sm:justify-between"><Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>Close</Button>{(user.role === "Owner" || user.role === "Admin") && <Link href="/admin/numbers" onClick={() => setHelpOpen(false)}><Button type="button">Manage numbers</Button></Link>}</DialogFooter></div></DialogContent></Dialog>
      {!showProfile && <Button onClick={() => setShowProfile(true)} className="fixed right-4 top-20 z-10 hidden rounded-lg border bg-white p-2 text-muted-foreground shadow-sm hover:bg-muted xl:block" aria-label="Show customer details" type="button" variant="ghost"><ChevronLeft className="size-4" /></Button>}
    </main>
  );
}

function RailLink({ children, label, active = false, href }: { children: React.ReactNode; label: string; active?: boolean; href: string }) {
  return <Link href={href} aria-label={label} title={label} className={`relative flex size-10 items-center justify-center rounded-xl transition-colors ${active ? "bg-[#e7f1ea] text-primary" : "text-slate-500 hover:bg-muted hover:text-slate-900"}`}>{children}<span className="sr-only">{label}</span></Link>;
}

function RailButton({ children, label, active = false, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return <Button aria-label={label} title={label} onClick={onClick} className={`relative flex size-10 items-center justify-center rounded-xl transition-colors ${active ? "bg-[#e7f1ea] text-primary" : "text-slate-500 hover:bg-muted hover:text-slate-900"}`} type="button" variant="ghost">{children}<span className="sr-only">{label}</span></Button>;
}

function ProfileRow({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{label}</span><span className="flex items-center gap-1.5 text-[11px] font-medium">{dot && <span className={`size-1.5 rounded-full ${dot}`} />}{value}</span></div>;
}
