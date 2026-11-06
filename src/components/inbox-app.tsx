"use client";

import { SelectControl } from "@/components/ui/select-control";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  AlertCircle, Archive, ArrowRightLeft, ArrowUpRight, AtSign, BarChart3, Bell, Check, CheckCheck, CheckCircle,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Filter,
  Info, Key, Lock, LogOut, MessageCircle, MessageSquare, MoreHorizontal, MoreVertical, Paperclip, Plus, Search, Send,
  Settings2, ShieldCheck, Smartphone, Smile, Sparkles, Users, Wifi, X,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageScroller, MessageScrollerButton, MessageScrollerContent, MessageScrollerItem, MessageScrollerProvider, MessageScrollerViewport } from "@/components/ui/message-scroller";
import { cn } from "@/lib/utils";

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

type SenderNumber = { id: string; label: string; number: string; state: string; allowedTeamIds?: string[]; assignedUserId?: string | null; assignedUserName?: string | null; provider?: "TWILIO" | "META"; metaPhoneNumberId?: string };
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
  return (
    <MessageScrollerItem id={message.id ? `crm-message-${message.id}` : undefined} messageId={messageId} scrollAnchor={!message.mine}>
      <div className={`flex w-full mb-3 ${message.mine ? "justify-end" : "justify-start"}`}>
        <div
          className={cn(
            "relative max-w-[85%] sm:max-w-[70%] md:max-w-[65%] rounded-2xl px-4 py-2.5 text-sm shadow-xs leading-relaxed",
            message.mine
              ? "rounded-tr-xs bg-primary text-primary-foreground"
              : "rounded-tl-xs bg-card text-card-foreground border border-border/70"
          )}
        >
          {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("image/") && (
            <Image src={message.media.accessUrl} alt={message.media.filename || "Attachment image"} width={480} height={360} unoptimized className="mb-2 max-h-72 w-auto max-w-full rounded-lg object-contain" />
          )}
          {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("video/") && (
            <video controls preload="none" src={message.media.accessUrl} className="mb-2 max-h-72 max-w-full rounded-lg" />
          )}
          {message.media?.stored && message.media.messageId && message.media.accessUrl && message.media.mimeType?.startsWith("audio/") && (
            <audio controls preload="none" src={message.media.accessUrl} className="mb-2 max-w-full" />
          )}
          {message.media && !/^(image|audio|video)\//.test(message.media.mimeType || "") && (
            <div className={cn(
              "mb-2 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs",
              message.mine ? "border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground" : "border-border bg-muted/50 text-foreground"
            )}>
              <Paperclip className="size-3.5 shrink-0 opacity-80" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{message.media.filename || `${message.media.type} attachment`}</p>
                <p className="text-[10px] opacity-75">{message.media.mimeType || message.media.type}{message.media.size ? ` · ${(message.media.size / (1024 * 1024)).toFixed(1)} MB` : ""}</p>
              </div>
              {message.media.stored && message.media.accessUrl && (
                <a href={message.media.accessUrl} className="shrink-0 text-xs font-semibold underline hover:opacity-80">Download</a>
              )}
            </div>
          )}
          <span className="whitespace-pre-wrap break-words inline text-sm">
            {message.media?.caption || message.text}
          </span>
          <span className={cn(
            "float-right ml-3 mt-1 inline-flex items-center gap-1 text-[10px] select-none",
            message.mine ? "text-primary-foreground/75" : "text-muted-foreground"
          )}>
            {message.mine && message.senderNumberId && (
              <span className="text-[10px] font-semibold text-primary-foreground/90 mr-0.5">
                {senderNumbers.find((number) => number.id === message.senderNumberId)?.label ?? "WhatsApp"}
              </span>
            )}
            <span>{message.time}</span>
            {message.mine && ["sent", "delivered", "read"].includes(message.status ?? "") && (
              <CheckCheck className={cn("size-3.5", message.status === "read" ? "text-primary-foreground font-bold" : "text-primary-foreground/75")} />
            )}
            {message.mine && message.status === "sent" && <Check className="size-3 text-primary-foreground/75" />}
            {message.mine && (message.status === "queued" || message.status === "local") && <Clock3 className="size-3 text-primary-foreground/75" />}
            {message.mine && message.status === "failed" && (
              <span className="text-destructive font-semibold text-[10px] flex items-center gap-1 bg-white/90 px-1 rounded">
                Failed
                {canRetry && message.id && (
                  <button type="button" onClick={() => onRetry(message.id!)} className="underline hover:text-destructive/80 ml-0.5">
                    Retry
                  </button>
                )}
              </span>
            )}
          </span>
        </div>
      </div>
    </MessageScrollerItem>
  );
}

function eligibleSenders(chat: Chat | undefined, numbers: SenderNumber[]) {
  if (chat?.eligibleSenderNumberIds && chat.eligibleSenderNumberIds.length > 0) {
    const eligibleIds = new Set(chat.eligibleSenderNumberIds);
    const filtered = numbers.filter((number) => number.state === "Active" && eligibleIds.has(number.id));
    if (filtered.length > 0) return filtered;
  }
  const activeNumbers = numbers.filter((number) => number.state === "Active");
  const filtered = activeNumbers.filter((number) => {
    if (!number.allowedTeamIds?.length) return true;
    const existingThread = chat?.conversationAssignments?.find((thread) => thread.channelNumberId === number.id);
    const teamId = existingThread ? existingThread.assignedTeamId : chat?.assignedTeamId;
    return Boolean(teamId && number.allowedTeamIds.includes(teamId));
  });
  return filtered.length > 0 ? filtered : activeNumbers;
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
  return (
    <Button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      variant="ghost"
      size="icon"
      className={cn("size-8 text-muted-foreground hover:text-foreground", className)}
    >
      {children}
    </Button>
  );
}

type AdminAlert = { id: string; severity: "INFO" | "WARNING" | "CRITICAL"; category: string; title: string; message: string; targetType: string | null; targetId: string | null; createdAt: string; readAt: string | null };

export function InboxApp({ user, cannedReplies = [], initialNumbers = [] }: { user: { id: string; name: string; email: string; role: string }; cannedReplies?: CannedReply[]; initialNumbers?: SenderNumber[] }) {
  const router = useRouter();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loadingChatId, setLoadingChatId] = useState("");
  const [viewThread, setViewThread] = useState<{ contactId: string; numberId: string } | null>(null);
  const pendingMessageJumpId = useRef("");
  const [senderNumbers, setSenderNumbers] = useState<SenderNumber[]>(() => initialNumbers.filter((n) => n.state === "Active"));
  const [channelNumbers, setChannelNumbers] = useState<SenderNumber[]>(() => initialNumbers);
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
  const isThreadFiltered = Boolean(viewThread != null && viewThread.contactId === activeChat?.id);
  // Unified conversation continuity: show full customer conversation history across all numbers by default
  const viewedThreadMessages = isThreadFiltered
    ? (activeChat?.messages ?? []).filter((message) => message.senderNumberId === viewThread!.numberId)
    : (activeChat?.messages ?? []);
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
  const agentAssignedNumber = senderNumbersForChat.find((number) => number.assignedUserId === user.id && number.state === "Active")
    ?? senderNumbers.find((number) => number.assignedUserId === user.id && number.state === "Active");
  const activeNumber = senderNumbersForChat.find((number) => number.id === activeNumberId)
    ?? agentAssignedNumber
    ?? senderNumbersForChat.find((number) => number.id === currentThreadNumberId)
    ?? senderNumbersForChat.find((number) => number.state === "Active")
    ?? senderNumbers.find((number) => number.state === "Active")
    ?? senderNumbersForChat[0]
    ?? senderNumbers[0]
    ?? null;
  const sendingThreadAssignment = activeChat?.conversationAssignments?.find((thread) => thread.channelNumberId === activeNumber?.id);
  const latestInboundForSender = activeChat?.messages.filter((message) => !message.mine && message.senderNumberId === activeNumber?.id).at(-1);
  const serviceWindowExpiresAt = sendingThreadAssignment?.serviceWindowExpiresAt !== undefined
    ? sendingThreadAssignment.serviceWindowExpiresAt
    : latestInboundForSender?.createdAt ? new Date(new Date(latestInboundForSender.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString() : null;
  const serviceWindowOpen = Boolean(serviceWindowExpiresAt && new Date(serviceWindowExpiresAt).getTime() > windowCheckTime);
  const activeSenderEligible = Boolean(activeNumber);
  const isTwilioSender = activeNumber?.provider === "TWILIO" || (Boolean(activeNumber) && !activeNumber?.metaPhoneNumberId);
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
      } catch (cause) {
        console.error("refreshInboxList error:", cause);
        if (!disposed) setNotice(cause instanceof Error ? cause.message : "Could not refresh CRM data. Check the database connection and retry.");
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
      setNotice(data.retry?.needsReview ? "The prior retry did not finish recording its outcome. Check the message status before sending again." : data.retry?.duplicate ? "This failed message already has a retry attempt." : `A new message was sent from ${activeNumber.label}; delivery status will update shortly.`);
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
    const source = consentSourceDraft.trim() || (status === "opted_in" ? "Direct agent verification" : "Customer requested opt-out");
    const wordingVersion = consentWordingVersionDraft.trim() || "v1.0";
    try {
      const response = await fetch(`/api/contacts/${activeChat.id}/consent`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, source, wordingVersion }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update consent.");
      setChats((current) => current.map((chat) => chat.id === activeChat.id ? { ...chat, ...data.chat, detailLoaded: true, matchesFilter: chat.matchesFilter } : chat));
      setConsentSourceDraft("");
      setConsentWordingVersionDraft("");
      setNotice(status === "opted_in" ? "Customer opt-in recorded. Messaging is enabled." : "Customer opt-out recorded. WhatsApp replies are blocked.");
      window.setTimeout(() => setNotice(""), 4000);
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

  return (
    <main className="flex h-screen min-h-[600px] overflow-hidden bg-background text-foreground font-sans flex-col">
      {notice && (
        <div className="border-b border-border bg-card p-2 px-4 shrink-0 z-50">
          <Alert variant="destructive" className="flex items-center justify-between py-2 border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2">
              <AlertCircle className="size-4 text-amber-600 dark:text-amber-400 shrink-0" />
              <AlertDescription className="text-xs font-medium text-amber-800 dark:text-amber-300">
                {notice}
              </AlertDescription>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300"
              onClick={() => setNotice("")}
              aria-label="Dismiss alert"
            >
              <X className="size-3.5" />
            </Button>
          </Alert>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* 1. Slim Left Rail (Shadcn Radix Sidebar Rail Style) */}
        <aside className="hidden w-16 shrink-0 flex-col items-center justify-between border-r border-border bg-sidebar py-3 sm:flex select-none">
          <div className="flex flex-col items-center gap-4">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link href="/" aria-label="WhatsApp CRM" className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs transition-transform hover:scale-105">
                  <MessageSquare className="size-5 fill-current" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={10} className="font-semibold text-xs">
                Relay CRM
              </TooltipContent>
            </Tooltip>
            <div className="flex flex-col items-center gap-1.5">
              <RailLink href="/" active label="Chats">
                <MessageSquare className="size-5" />
              </RailLink>
              <RailLink href="/customers" label="Customers">
                <Users className="size-5" />
              </RailLink>
              {adminCanPurgeMedia && (
                <>
                  <RailLink href="/admin/numbers" label="WhatsApp Numbers">
                    <Smartphone className="size-5" />
                  </RailLink>
                  <RailLink href="/reports" label="AI Analytics">
                    <BarChart3 className="size-5" />
                  </RailLink>
                </>
              )}
            </div>
          </div>

          <div className="flex flex-col items-center gap-2">
            {adminCanPurgeMedia && (
              <RailLink href="/admin/numbers" label="Workspace settings">
                <Settings2 className="size-5" />
              </RailLink>
            )}
            <RailButton label="Help" onClick={() => setHelpOpen(true)}>
              <CircleHelp className="size-5" />
            </RailButton>

            {/* User profile with standard Shadcn DropdownMenu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Open account menu"
                  title={user.name}
                  className="size-10 rounded-full p-0 hover:bg-muted"
                  type="button"
                  variant="ghost"
                >
                  <Avatar className="size-9 border border-border">
                    <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                      {user.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" side="right" className="w-60">
                <DropdownMenuLabel>
                  <div className="truncate text-xs font-semibold">{user.name}</div>
                  <div className="truncate text-[11px] font-normal text-muted-foreground">{user.email}</div>
                  <Badge variant="secondary" className="mt-1 text-[10px]">{user.role}</Badge>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/account/security" className="text-xs cursor-pointer">
                    <Key className="size-3.5 mr-2" /> Account security
                  </Link>
                </DropdownMenuItem>
                {adminCanPurgeMedia && (
                  <DropdownMenuItem asChild>
                    <Link href="/admin/numbers" className="text-xs cursor-pointer">
                      <Settings2 className="size-3.5 mr-2" /> Workspace administration
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void signOut()} className="text-xs text-destructive focus:text-destructive cursor-pointer">
                  <LogOut className="size-3.5 mr-2" /> Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </aside>

        {/* 2. Conversations Column (WhatsApp Chat List) */}
        <section className={`${activeId ? "hidden sm:flex" : "flex"} w-full sm:w-[360px] md:w-[390px] lg:w-[420px] shrink-0 flex-col border-r border-border bg-card h-full`}>
          {/* Chats Header */}
          <div className="flex h-14 items-center justify-between border-b border-border bg-card/50 px-4 shrink-0">
            <h1 className="text-lg font-bold tracking-tight text-foreground">Chats</h1>
            <div className="flex items-center gap-1 text-muted-foreground">
              {(user.role === "Owner" || user.role === "Admin") && (
                <div className="relative">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg relative text-muted-foreground hover:text-foreground"
                    onClick={() => { setAlertsOpen((open) => !open); void refreshAlerts(); }}
                    aria-label={`Admin alerts${alertCount ? `, ${alertCount} unread` : ""}`}
                  >
                    <Bell className="size-4" />
                    {alertCount > 0 && (
                      <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[9px] font-bold text-destructive-foreground">
                        {alertCount > 99 ? "99+" : alertCount}
                      </span>
                    )}
                  </Button>
                  {alertsOpen && (
                    <Card aria-label="Admin alerts" className="absolute left-0 sm:left-auto sm:right-0 top-11 z-50 w-[min(360px,calc(100vw-2rem))] overflow-hidden border-border shadow-2xl">
                      <CardHeader className="flex flex-row items-center justify-between border-b border-border px-4 py-3 bg-muted/40 space-y-0">
                        <div>
                          <CardTitle className="text-sm font-semibold text-foreground">Admin alerts</CardTitle>
                          <p className="text-[10px] text-muted-foreground">Number, delivery, webhook, and failover events</p>
                        </div>
                        <Button variant="ghost" size="sm" disabled={!alertCount} onClick={() => void markAlertRead()} className="text-xs text-primary hover:bg-primary/10">
                          Mark read
                        </Button>
                      </CardHeader>
                      <CardContent className="p-0 max-h-[60vh] overflow-y-auto">
                        {alerts.map((alert) => {
                          const params = new URLSearchParams();
                          if (alert.targetId && alert.targetType === "CHANNEL_NUMBER") params.set("number", alert.targetId);
                          if (alert.targetId && alert.targetType === "WHATSAPP_BUSINESS_ACCOUNT") params.set("waba", alert.targetId);
                          const numberTarget = params.size > 0 ? `/admin/numbers?${params.toString()}` : "/admin/numbers";
                          const href = alert.targetType === "WEBHOOK_EVENT" ? "/admin/webhooks" : alert.targetType === "CHANNEL_NUMBER" || alert.targetType === "WHATSAPP_BUSINESS_ACCOUNT" || alert.targetType === "FAILOVER_EVENT" ? numberTarget : alert.targetType === "CONTACT" && alert.targetId ? `/?contact=${encodeURIComponent(alert.targetId)}` : "/admin/numbers";
                          return (
                            <Link href={href} key={alert.id} onClick={() => { setAlertsOpen(false); if (!alert.readAt) void markAlertRead(alert.id); }} className={cn("block border-b border-border px-4 py-3 hover:bg-muted/40 transition-colors", alert.readAt ? "bg-card" : "bg-primary/5")}>
                              <div className="flex items-start justify-between gap-2">
                                <p className="text-xs font-semibold text-foreground">{alert.title}</p>
                                <Badge variant={alert.severity === "CRITICAL" ? "destructive" : "secondary"}>
                                  {alert.severity === "CRITICAL" ? "Urgent" : "Info"}
                                </Badge>
                              </div>
                              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{alert.message}</p>
                              <p className="mt-2 text-[10px] text-muted-foreground">{new Date(alert.createdAt).toLocaleString()}</p>
                            </Link>
                          );
                        })}
                        {alerts.length === 0 && <p className="p-6 text-center text-xs text-muted-foreground">No alerts yet. Critical WhatsApp events will appear here.</p>}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
              <Button asChild variant="ghost" size="icon" className="size-8 rounded-lg text-muted-foreground hover:text-foreground">
                <Link href="/customers?new=1" aria-label="New chat" title="New chat">
                  <Plus className="size-4" />
                </Link>
              </Button>
            </div>
          </div>

          {/* WhatsApp Search Bar */}
          <div className="p-2.5 pb-2 border-b border-border bg-card">
            <div className="relative flex items-center">
              <Search className="absolute left-3 size-4 shrink-0 text-muted-foreground pointer-events-none" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search or start new chat"
                className="h-9 pl-9 pr-8 text-xs bg-muted/40 border-border focus-visible:bg-background"
              />
              {query && (
                <Button type="button" variant="ghost" size="icon" onClick={() => setQuery("")} className="absolute right-1 size-7 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                  <X className="size-3.5" />
                </Button>
              )}
            </div>
          </div>

          {/* WhatsApp Filter Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 py-2 border-b border-border">
            {["All", "Unread", "Open", "Waiting", "Resolved", "Mine"].map((tab) => {
              const label = tab === "All" ? "All messages" : tab;
              const isActive = activeTab === (tab === "All" ? "All messages" : tab);
              return (
                <Button
                  key={tab}
                  type="button"
                  variant={isActive ? "default" : "secondary"}
                  size="sm"
                  onClick={() => setActiveTab(label)}
                  className={cn(
                    "h-7 rounded-full px-3 text-xs font-medium cursor-pointer transition-all",
                    isActive ? "shadow-2xs font-semibold" : "text-muted-foreground hover:text-foreground bg-muted/60"
                  )}
                >
                  {tab}
                  {tab === "Unread" && unreadCount > 0 && (
                    <span className="ml-1.5 rounded-full bg-primary-foreground text-primary px-1 text-[10px] font-bold">
                      {unreadCount}
                    </span>
                  )}
                </Button>
              );
            })}
            <Button variant="ghost" size="icon" className="ml-auto size-7 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setFilterOpen((open) => !open)} aria-label="Filter conversations">
              <Filter className="size-3.5" />
            </Button>
          </div>

          {/* Saved Inbox Views */}
          {savedInboxViews.length > 0 && (
            <div aria-label="Saved inbox views" className="flex gap-1.5 overflow-x-auto px-3 py-1.5 border-b border-border">
              {savedInboxViews.map((view) => (
                <div key={view.id} className="flex shrink-0 items-center rounded-full border border-border bg-card">
                  <Button type="button" size="sm" variant="ghost" className="h-6 rounded-r-none px-2 text-[10px] text-muted-foreground" onClick={() => applyInboxView(view)}>
                    {view.name}
                  </Button>
                  <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${view.name}`} className="size-6 rounded-l-none text-muted-foreground hover:text-destructive" disabled={savedInboxViewsBusy} onClick={() => void deleteInboxView(view)}>
                    <X className="size-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Advanced Filters Drawer */}
          {filterOpen && (
            <div className="grid grid-cols-2 gap-2 p-3 bg-muted/40 border-b border-border">
              <SelectControl aria-label="Filter by state" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-[11px] text-foreground">
                <option>All states</option>
                <option>Open</option>
                <option>Waiting</option>
                <option>Resolved</option>
              </SelectControl>
              <SelectControl aria-label="Filter by WhatsApp number" value={numberFilter} onChange={(event) => setNumberFilter(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-[11px] text-foreground">
                <option value="">All numbers</option>
                {channelNumbers.map((number) => <option key={number.id} value={number.id}>{number.label} · {number.number}</option>)}
              </SelectControl>
              <SelectControl aria-label="Filter by team" value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-[11px] text-foreground">
                <option value="">All teams</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </SelectControl>
              <SelectControl aria-label="Filter by tag" value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="h-8 rounded-md border border-border bg-card px-2 text-[11px] text-foreground">
                <option value="">All tags</option>
                {[...new Set([...availableTags, ...chats.flatMap((chat) => chat.tags ?? (chat.label ? [chat.label] : []))])].sort().map((tag) => <option key={tag} value={tag}>{tag}</option>)}
              </SelectControl>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px] bg-card" onClick={() => { setStateFilter("All states"); setNumberFilter(""); setTeamFilter(""); setTagFilter(""); setDateFrom(""); setDateTo(""); setActiveTab("All messages"); }}>
                Reset filters
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 text-[11px] bg-card" onClick={() => setSaveViewOpen((open) => !open)}>
                Save view
              </Button>
              {saveViewOpen && (
                <div className="col-span-2 flex gap-2 pt-1">
                  <Input aria-label="Saved view name" maxLength={40} placeholder="Name this view" value={saveViewName} onChange={(event) => setSaveViewName(event.target.value)} className="h-8 text-xs bg-card" />
                  <Button type="button" size="sm" className="h-8" disabled={savedInboxViewsBusy || !saveViewName.trim()} onClick={() => void saveInboxView()}>
                    {savedInboxViewsBusy ? "Saving…" : "Save"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* WhatsApp Chat List Items */}
          <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
            {visibleChats.map((chat) => {
              const isSelected = activeId === chat.id;
              return (
                <button
                  key={chat.id}
                  onClick={() => openChat(chat)}
                  className={cn(
                    "flex w-full items-start gap-3 p-3 rounded-xl text-left transition-all cursor-pointer border border-transparent",
                    isSelected
                      ? "bg-muted shadow-2xs border-border/40 font-medium"
                      : "hover:bg-muted/50 bg-card/40"
                  )}
                  type="button"
                >
                  <div className="relative shrink-0">
                    <Avatar className="size-10">
                      <AvatarFallback className={cn("text-xs font-semibold text-white", chat.color)}>
                        {chat.initials}
                      </AvatarFallback>
                    </Avatar>
                    <span
                      className={cn(
                        "absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card",
                        chat.state === "Open" ? "bg-emerald-500" : chat.state === "Waiting" ? "bg-amber-500" : "bg-muted-foreground/60"
                      )}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1 mb-0.5">
                      <span className="truncate text-sm font-semibold text-foreground">{chat.name}</span>
                      <span className={cn("shrink-0 text-[11px]", chat.unread ? "text-primary font-bold" : "text-muted-foreground")}>
                        {chat.time}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-xs text-muted-foreground leading-snug flex-1">
                        {chat.preview || "No conversation yet"}
                      </p>
                      {chat.unread ? (
                        <Badge variant="default" className="size-5 rounded-full p-0 flex items-center justify-center text-[10px] font-bold shrink-0">
                          {chat.unread}
                        </Badge>
                      ) : null}
                    </div>
                    <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-normal text-muted-foreground capitalize">
                        {chat.state ?? "Open"}
                      </Badge>
                      {chat.messageCount ? (
                        <span className="truncate">· {channelNumbers.find((n) => n.id === chat.latestMessageSenderNumberId)?.label ?? "WhatsApp"}</span>
                      ) : null}
                      <QueueAgeBadge chat={chat} />
                    </div>
                  </div>
                </button>
              );
            })}
            {visibleChats.length === 0 && (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No conversations found.
              </div>
            )}
          </div>

          {/* Bottom Numbers Status Pill */}
          <div className="border-t border-border p-2.5 bg-sidebar/50 shrink-0">
            <Link href="/admin/numbers" className="flex items-center gap-3 rounded-xl border border-border bg-card p-2.5 shadow-2xs hover:bg-accent/40 transition-colors">
              <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                <Wifi className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold text-foreground truncate">
                  {senderNumbers.length} connected WhatsApp number{senderNumbers.length === 1 ? "" : "s"}
                </div>
                <div className="text-[10px] text-muted-foreground truncate">Twilio WhatsApp multi-account gateway</div>
              </div>
              <ChevronRight className="size-4 text-muted-foreground shrink-0" />
            </Link>
          </div>
        </section>

      {/* 3. Right Chat Viewport */}
      {activeChat ? (
        <section className="flex min-w-0 flex-1 flex-col h-full bg-muted/15 relative">
          {/* WhatsApp Chat Header */}
          <header className="flex h-14 items-center justify-between border-b border-border bg-background px-4 shrink-0 select-none">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setActiveId("")}
                className="sm:hidden size-8 text-muted-foreground hover:text-foreground"
                aria-label="Back to chat list"
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Avatar className="size-9 shrink-0 cursor-pointer" onClick={() => setShowProfile((open) => !open)}>
                <AvatarFallback className={cn("text-xs font-semibold text-white", activeChat.color)}>
                  {activeChat.initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 cursor-pointer" onClick={() => setShowProfile((open) => !open)}>
                <div className="flex items-center gap-2">
                  <h2 className="truncate text-sm font-semibold text-foreground leading-none">{activeChat.name}</h2>
                  <Badge variant="outline" className="hidden sm:inline-flex text-[10px] py-0 px-1.5 font-normal text-muted-foreground">
                    {activeThreadState}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground mt-0.5 leading-none">
                  {activeChat.phone}
                </p>
              </div>
            </div>

            {/* Header Right Actions */}
            <div className="flex items-center gap-2">
              {/* Sender Number Selector with Shadcn DropdownMenu */}
              <DropdownMenu open={numberMenu} onOpenChange={setNumberMenu}>
                <DropdownMenuTrigger asChild>
                  <Button
                    disabled={!senderNumbersForChat.length}
                    className="h-8 gap-2 px-3 text-xs font-medium rounded-md shadow-2xs border-border"
                    type="button"
                    variant="outline"
                  >
                    <span className={cn("size-2 rounded-full", activeNumber ? "bg-emerald-500" : "bg-muted-foreground")} />
                    <span className="hidden sm:inline font-semibold text-foreground">
                      {activeNumber?.label ?? "No number"}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {activeNumber?.number}
                    </span>
                    {senderNumbers.length > 0 && <ChevronDown className="size-3 text-muted-foreground ml-0.5" />}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-72">
                  <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Switch active Twilio sender
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {senderNumbersForChat.length ? (
                    senderNumbersForChat.map((number) => (
                      <DropdownMenuItem
                        key={number.id}
                        onClick={() => {
                          setActiveNumberId(number.id);
                          setViewThread({ contactId: activeChat.id, numberId: number.id });
                        }}
                        className="flex items-center gap-2.5 cursor-pointer py-2"
                      >
                        <span className="size-2 rounded-full bg-emerald-500" />
                        <div className="min-w-0 flex-1">
                          <span className="block text-xs font-semibold text-foreground">{number.label}</span>
                          <span className="block text-[11px] text-muted-foreground">{number.number}</span>
                        </div>
                        {activeNumber?.id === number.id && <Check className="size-4 text-primary" />}
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <div className="p-3 text-xs text-muted-foreground">No active numbers available for this team.</div>
                  )}
                  {user.role !== "Agent" && senderNumbersForChat.length > 1 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => beginReroute()} className="text-xs text-primary cursor-pointer">
                        <ArrowRightLeft className="size-3.5 mr-2" /> Reroute conversation thread
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              <Button
                variant="ghost"
                size="icon"
                className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                onClick={() => setShowProfile((open) => !open)}
                aria-label="Contact info"
              >
                <Info className="size-4" />
              </Button>
            </div>
          </header>

          {/* Messages Viewport with WhatsApp Layout */}
          <MessageScrollerProvider autoScroll defaultScrollPosition="end">
            <MessageScroller className="flex-1 overflow-hidden relative">
              <MessageScrollerViewport
                aria-label={`Conversation with ${activeChat.name}`}
                className="h-full px-4 py-3 md:px-12 bg-muted/15"
              >
                <MessageScrollerContent className="mx-auto flex w-full max-w-3xl flex-col pb-4">
                  {/* Subtle WhatsApp Encryption Banner */}
                  <div className="my-2 flex justify-center">
                    <Badge variant="outline" className="flex items-center gap-1.5 px-3 py-1 text-center text-xs font-normal text-muted-foreground bg-card/80 backdrop-blur shadow-2xs">
                      <Lock className="size-3 text-muted-foreground shrink-0" />
                      Messages and media are end-to-end encrypted in your CRM timeline.
                    </Badge>
                  </div>

                  {!activeChat.detailLoaded && (
                    <div className="my-2 flex justify-center">
                      <span className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground shadow-2xs">
                        {loadingChatId === activeId ? "Loading conversation history…" : "Loading messages…"}
                      </span>
                    </div>
                  )}

                  {senderChanged && previousSender && activeNumber && (
                    <Alert className="my-2 border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 shadow-2xs">
                      <div className="flex items-center gap-1.5 font-semibold text-amber-900 dark:text-amber-300">
                        <Info className="size-4" /> This chat switched WhatsApp sender number
                      </div>
                      <AlertDescription className="mt-1 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200/80">
                        Previous messages were sent from {previousSender.label} ({previousSender.number}). New replies will use {activeNumber.label} ({activeNumber.number}). Conversation history is preserved across sender numbers.
                      </AlertDescription>
                    </Alert>
                  )}

                  {isThreadFiltered && (
                    <div className="my-2 flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs">
                      <span className="text-muted-foreground">
                        Filtered to sender thread: <strong className="text-foreground">{channelNumbers.find((n) => n.id === viewThread?.numberId)?.label ?? "WhatsApp"}</strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setViewThread(null)}
                        className="text-xs font-medium text-primary hover:underline cursor-pointer"
                      >
                        Show full conversation history
                      </button>
                    </div>
                  )}

                  {/* Today date pill */}
                  <div className="my-2 flex justify-center">
                    <Badge variant="outline" className="px-3 py-0.5 text-[11px] font-medium text-muted-foreground bg-card/80 backdrop-blur shadow-2xs">
                      Today
                    </Badge>
                  </div>

                  {/* WhatsApp Messages */}
                  {viewedThreadMessages.map((message, index) => (
                    <InboxMessageRow
                      key={message.id ?? `${activeChat.id}-${index}`}
                      chat={activeChat}
                      message={message}
                      index={index}
                      senderNumbers={channelNumbers}
                      canRetry={adminCanRetryMessages}
                      canPurge={adminCanPurgeMedia}
                      sending={sending}
                      onRetry={(messageId) => void retryFailedMessage(messageId)}
                      onPurge={(messageId) => void purgeAttachment(messageId)}
                    />
                  ))}

                  {viewedThreadMessages.length === 0 && (
                    <div className="my-8 flex justify-center">
                      <span className="rounded-lg border border-border bg-card px-4 py-2 text-xs text-muted-foreground shadow-2xs text-center max-w-sm">
                        {isTwilioSender
                          ? "No messages in this WhatsApp number thread yet. Type a message below to start the conversation."
                          : "No messages in this WhatsApp number thread yet. Start the conversation with an approved template below."}
                      </span>
                    </div>
                  )}

                  {/* Internal Team Notes */}
                  {activeChat.internalNotes?.map((note) => (
                    <Alert key={note.id} className="mx-auto my-2 w-full max-w-lg border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 shadow-2xs">
                      <div className="flex items-center justify-between font-semibold text-[11px] text-amber-800 dark:text-amber-300 mb-1">
                        <span className="flex items-center gap-1.5"><Lock className="size-3" /> Internal note · Team only</span>
                        <span className="font-normal text-[10px] text-amber-700 dark:text-amber-400">{note.author} · {note.time}</span>
                      </div>
                      <AlertDescription className="text-xs text-foreground whitespace-pre-wrap leading-relaxed">
                        {note.text}
                      </AlertDescription>
                    </Alert>
                  ))}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton aria-label="Jump to latest message" />
            </MessageScroller>
          </MessageScrollerProvider>

          {/* WhatsApp Composer */}
          <div className="border-t border-border bg-card p-3 shrink-0 flex flex-col gap-2.5">
            {/* Top mode bar & 24hr window status */}
            <div className="flex items-center justify-between gap-2">
              <Tabs
                value={composerMode}
                onValueChange={(val) => {
                  if (val === "template" || val === "note") {
                    setSavedReplyOpen(false);
                    setEmojiOpen(false);
                    selectAttachment(null);
                  }
                  setComposerMode(val as "reply" | "template" | "note");
                }}
              >
                <TabsList className="h-8 bg-muted/60 p-0.5">
                  <TabsTrigger value="reply" className="text-xs h-7 px-3">Reply</TabsTrigger>
                  <TabsTrigger value="template" className="text-xs h-7 px-3">Template</TabsTrigger>
                  <TabsTrigger value="note" className="text-xs h-7 px-3">Internal note</TabsTrigger>
                </TabsList>
              </Tabs>

              {composerMode === "reply" && replyAllowed && activeNumber && (
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Clock3 className="size-3 text-primary" />
                  <span>
                    {isTwilioSender
                      ? "Twilio WhatsApp connected"
                      : serviceWindowOpen
                      ? `24hr window open${serviceWindowExpiresAt ? ` until ${new Date(serviceWindowExpiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}`
                      : "Window closed · use template"}
                  </span>
                </div>
              )}
            </div>

            {/* Warnings when reply not permitted */}
            {!replyAllowed && composerMode !== "note" && (
              <Alert className="border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200 py-2 px-3 flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <AlertCircle className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                  <AlertDescription className="text-xs text-amber-800 dark:text-amber-300 font-medium">
                    {consentStatus === "opted_out"
                      ? "Customer opted out of WhatsApp messages."
                      : "WhatsApp opt-in is not recorded yet. Record opt-in to enable sending."}
                  </AlertDescription>
                </div>
                {consentStatus !== "opted_out" && (
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold px-3 shadow-xs shrink-0"
                    onClick={() => void updateConsent("opted_in")}
                  >
                    <CheckCircle className="size-3.5 mr-1.5" />
                    Record Opt-in
                  </Button>
                )}
              </Alert>
            )}

            {/* Attachment Preview Box */}
            {composerMode === "reply" && (
              <input
                ref={attachmentInput}
                type="file"
                hidden
                accept="image/jpeg,image/png,video/mp4,audio/aac,audio/mp4,audio/mpeg,audio/amr,audio/ogg,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                onChange={(event) => selectAttachment(event.target.files?.[0] ?? null)}
              />
            )}
            {composerMode === "reply" && attachment && (
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-2">
                {attachmentPreview ? (
                  <Image src={attachmentPreview} alt="Attachment preview" width={48} height={48} unoptimized className="size-12 rounded object-cover" />
                ) : (
                  <div className="flex size-12 items-center justify-center rounded bg-muted text-primary">
                    <Paperclip className="size-5" />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{attachment.name}</p>
                  <p className="text-[10px] text-muted-foreground">{(attachment.size / (1024 * 1024)).toFixed(1)} MB</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => { selectAttachment(null); if (attachmentInput.current) attachmentInput.current.value = ""; }}
                  className="size-7 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </Button>
              </div>
            )}

            {/* Template Mode Form */}
            {composerMode === "template" ? (
              <div className="rounded-lg bg-card p-3 border border-border flex flex-col gap-2">
                <label className="text-xs font-semibold text-foreground">
                  Approved WhatsApp Template
                  <SelectControl
                    value={selectedTemplateId}
                    onChange={(event) => {
                      const id = event.target.value;
                      setSelectedTemplateId(id);
                      const item = approvedTemplates.find((template) => template.id === id);
                      setTemplateParameters(Array.from({ length: templateVariables(templateBody(item)).length }, () => ""));
                    }}
                    className="mt-1 h-9 rounded-lg border border-border bg-card px-3 text-xs w-full text-foreground"
                  >
                    <option value="">Select a template</option>
                    {approvedTemplates.map((template) => (
                      <option key={template.id} value={template.id}>{template.name} · {template.language}</option>
                    ))}
                  </SelectControl>
                </label>
                {selectedTemplate && selectedTemplateParameterCount > 0 && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {templateParameters.map((value, index) => {
                      const variable = selectedTemplateVariables[index];
                      return (
                        <label key={`${selectedTemplate.id}-${variable}`} className="text-xs font-medium text-muted-foreground">
                          Value for {`{{${variable}}}`}
                          <Input
                            value={value}
                            maxLength={1024}
                            onChange={(event) => setTemplateParameters((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))}
                            placeholder={`Value for ${variable}`}
                            className="mt-1 h-8 text-xs bg-muted/40"
                          />
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedTemplate && (
                  <div className="rounded-lg bg-muted/40 p-2.5 text-xs text-foreground border border-border">
                    <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Preview · {selectedTemplate.category}
                    </span>
                    {selectedTemplatePreview || "No text preview"}
                  </div>
                )}
                <div className="flex justify-end pt-1">
                  <Button
                    onClick={() => void sendTemplateMessage()}
                    disabled={sending || !selectedTemplate || !replyAllowed || !activeNumber || !activeSenderEligible || templateParameters.length !== selectedTemplateParameterCount || templateParameters.some((value) => !value.trim())}
                    className="rounded-lg px-4 text-xs font-semibold"
                  >
                    {sending ? "Sending…" : "Send template"}
                  </Button>
                </div>
              </div>
            ) : (
              /* Reply / Note Main Bar */
              <div className="flex items-end gap-2 rounded-xl border border-border bg-background p-2 shadow-2xs focus-within:ring-1 focus-within:ring-ring transition-all">
                {/* Left WhatsApp Icons */}
                <div className="flex items-center gap-0.5 pb-0.5 text-muted-foreground">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => setEmojiOpen((open) => !open)}
                    aria-label="Emoji"
                  >
                    <Smile className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => attachmentInput.current?.click()}
                    aria-label="Attach file"
                  >
                    <Paperclip className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 rounded-lg text-muted-foreground hover:text-foreground"
                    onClick={() => { setEmojiOpen(false); setSavedReplyOpen((open) => !open); }}
                    aria-label="Saved replies"
                  >
                    <Sparkles className="size-4" />
                  </Button>
                </div>

                {/* Textarea Input */}
                <div className="flex-1 relative">
                  <Textarea
                    ref={draftInputRef}
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    disabled={!activeChat.detailLoaded || (composerMode === "reply" && (!replyAllowed || !activeNumber || !activeSenderEligible || (!isTwilioSender && !serviceWindowOpen)))}
                    onKeyDown={(event) => {
                      if (composerMode === "reply" && (event.key === " " || event.key === "Tab")) {
                        const match = /(?:^|\s);([a-z0-9_-]{1,24})$/i.exec(draft);
                        const reply = match ? cannedReplies.find((item) => item.shortcut?.toLowerCase() === match[1].toLowerCase()) : undefined;
                        if (match && reply) {
                          event.preventDefault();
                          const prefix = draft.slice(0, draft.length - match[0].length);
                          setDraft(`${prefix}${prefix && !/\s$/.test(prefix) ? " " : ""}${personalizedReply(reply)}${event.key === " " ? " " : ""}`);
                          setSavedReplyOpen(false);
                          return;
                        }
                      }
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        if (composerMode === "note") void saveInternalNote();
                        else void sendMessage();
                      }
                    }}
                    placeholder={
                      composerMode === "note"
                        ? "Write private internal note for your team..."
                        : !activeNumber
                        ? "No active WhatsApp sender number selected"
                        : !replyAllowed
                        ? "Replies disabled until opt-in is recorded"
                        : !isTwilioSender && !serviceWindowOpen
                        ? "24hr customer service window closed · switch to Template"
                        : "Type a message"
                    }
                    rows={1}
                    className="w-full resize-none rounded-lg bg-transparent px-3 py-2 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground border-0 shadow-none focus-visible:ring-0 min-h-[38px] max-h-32"
                  />

                  {/* Emoji Picker Popup */}
                  {emojiOpen && (
                    <div className="absolute bottom-12 left-0 z-50 flex flex-wrap gap-1 rounded-xl border border-border bg-card p-2 shadow-xl">
                      {["😀", "😊", "👍", "❤️", "🎉", "🙏", "✅", "👋", "🙂", "🤔", "✨", "💬"].map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => { setDraft((c) => `${c}${emoji}`); setEmojiOpen(false); draftInputRef.current?.focus(); }}
                          className="size-9 rounded-lg text-lg hover:bg-muted flex items-center justify-center cursor-pointer"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Saved Replies Popup */}
                  {savedReplyOpen && (
                    <div className="absolute bottom-12 left-0 z-50 w-72 max-h-60 overflow-y-auto rounded-xl border border-border bg-card p-2 shadow-xl">
                      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quick Saved Replies</div>
                      {cannedReplies.length ? (
                        cannedReplies.map((reply) => (
                          <button
                            key={reply.id}
                            type="button"
                            onClick={() => insertSavedReply(reply)}
                            className="w-full text-left rounded-lg px-2.5 py-2 hover:bg-muted transition-colors cursor-pointer"
                          >
                            <span className="block text-xs font-semibold text-foreground">{reply.title}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{personalizedReply(reply)}</span>
                          </button>
                        ))
                      ) : (
                        <p className="px-2 py-3 text-xs text-muted-foreground">No saved replies yet.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Shadcn Send Button */}
                <Button
                  type="button"
                  size="icon"
                  disabled={
                    sending || !activeChat.detailLoaded ||
                    (composerMode === "note"
                      ? !draft.trim()
                      : (!draft.trim() && !attachment) || !replyAllowed || !activeNumber || !activeSenderEligible || (!isTwilioSender && !serviceWindowOpen))
                  }
                  onClick={() => (composerMode === "note" ? void saveInternalNote() : void sendMessage())}
                  className={cn(
                    "size-9 rounded-lg shrink-0 shadow-xs transition-transform active:scale-95",
                    composerMode === "note"
                      ? "bg-amber-600 hover:bg-amber-700 text-white"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  )}
                  aria-label="Send"
                >
                  <Send className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </section>
      ) : (
        /* WhatsApp Web Empty Intro Screen (when no chat is active) */
        <section className="hidden md:flex flex-1 flex-col items-center justify-center bg-muted/20 p-8 text-center border-b-[6px] border-primary select-none h-full">
          <div className="max-w-md flex flex-col items-center">
            <div className="size-20 rounded-2xl bg-primary/10 flex items-center justify-center mb-6 text-primary shadow-2xs">
              <MessageSquare className="size-10" />
            </div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">WhatsApp CRM Web</h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              Send and receive WhatsApp messages with your customers across connected Twilio numbers with unified timeline storage.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <Button asChild size="sm" className="text-xs font-semibold px-4 rounded-lg shadow-xs">
                <Link href="/customers?new=1">
                  <Plus className="size-3.5 mr-1.5" /> Add customer
                </Link>
              </Button>
              {adminCanPurgeMedia && (
                <Button asChild variant="outline" size="sm" className="border-border text-foreground bg-card hover:bg-muted text-xs font-semibold px-4 rounded-lg">
                  <Link href="/admin/numbers">
                    <Smartphone className="size-3.5 mr-1.5" /> Manage numbers
                  </Link>
                </Button>
              )}
            </div>
            <div className="mt-16 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Lock className="size-3.5 text-muted-foreground" />
              <span>End-to-end encrypted CRM messaging</span>
            </div>
          </div>
        </section>
      )}

      {/* 4. Customer Details Right Drawer (WhatsApp Contact Info style) */}
      {showProfile && activeChat && (
        <aside className="hidden w-[340px] xl:w-[360px] shrink-0 flex-col border-l border-border bg-card xl:flex h-full overflow-y-auto">
          {/* Header */}
          <div className="flex h-[60px] items-center justify-between border-b border-border bg-muted/40 px-4 shrink-0">
            <span className="text-[15px] font-semibold text-foreground">Contact info</span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowProfile(false)}
              aria-label="Close"
              className="rounded-full size-8 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-5" />
            </Button>
          </div>

          {/* Profile Card */}
          <div className="bg-card border-b border-border p-6 flex flex-col items-center text-center">
            <Avatar className="size-20">
              <AvatarFallback className={`${activeChat.color} text-white font-medium text-2xl`}>
                {activeChat.initials}
              </AvatarFallback>
            </Avatar>
            <h3 className="mt-3 text-base font-semibold text-foreground">{activeChat.name}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{activeChat.phone}</p>
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!activeThreadExists}
                className="h-8 text-xs border-border"
                onClick={() => void updateConversation(activeChat.id, activeThreadState === "Waiting" ? "reopen" : "wait", undefined, undefined, undefined, viewedThreadNumberId)}
              >
                <Clock3 className="size-3.5 mr-1 text-muted-foreground" />
                {activeThreadState === "Waiting" ? "Reopen" : "Waiting"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!activeThreadExists}
                className="h-8 text-xs border-border"
                onClick={() => void updateConversation(activeChat.id, activeThreadState === "Resolved" ? "reopen" : "resolve", undefined, undefined, undefined, viewedThreadNumberId)}
              >
                <Archive className="size-3.5 mr-1 text-muted-foreground" />
                {activeThreadState === "Resolved" ? "Reopen" : "Resolve"}
              </Button>
            </div>
          </div>

          {/* WhatsApp Consent Card */}
          <div className="bg-card border-y border-border p-4 mt-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-foreground">WhatsApp Consent</h4>
              <Badge
                variant="outline"
                className={
                  consentStatus === "opted_in"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : consentStatus === "opted_out"
                    ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
                    : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                }
              >
                {consentStatus === "opted_in" ? "Opted in" : consentStatus === "opted_out" ? "Opted out" : "Not recorded"}
              </Badge>
            </div>
            {activeChat.consentSource && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Latest: {activeChat.consentSource}
              </p>
            )}
            <Input
              value={consentSourceDraft}
              onChange={(e) => setConsentSourceDraft(e.target.value)}
              placeholder="Consent source / link"
              className="mt-2.5 h-8 text-xs bg-muted/40 border-border"
            />
            <Input
              value={consentWordingVersionDraft}
              onChange={(e) => setConsentWordingVersionDraft(e.target.value)}
              placeholder="Wording version (e.g. v1.0)"
              className="mt-1.5 h-8 text-xs bg-muted/40 border-border"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs border-emerald-300 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                onClick={() => void updateConsent("opted_in")}
              >
                Record opt-in
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 border-red-300 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/50 text-xs"
                onClick={() => void updateConsent("opted_out")}
              >
                Record opt-out
              </Button>
            </div>
          </div>

          {/* Routing & Assignment Card */}
          <div className="bg-card border-y border-border p-4 mt-2 flex flex-col gap-2.5">
            <h4 className="text-xs font-semibold text-foreground">Assignment & Routing</h4>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Assigned agent</span>
              <SelectControl
                aria-label="Assign conversation"
                disabled={!activeThreadExists}
                value={activeThreadAssigneeId ?? ""}
                onChange={(event) => void updateConversation(activeChat.id, "assign", event.target.value || null, undefined, undefined, viewedThreadNumberId)}
                className="h-8 max-w-[150px] rounded border border-border bg-card px-2 text-xs text-foreground"
              >
                <option value="">Unassigned</option>
                {eligibleAssignees.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
              </SelectControl>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Team</span>
              <SelectControl
                aria-label="Assign team"
                disabled={!activeThreadExists}
                value={activeThreadTeamId ?? ""}
                onChange={(event) => void updateConversation(activeChat.id, "assign_team", undefined, undefined, event.target.value || null, viewedThreadNumberId)}
                className="h-8 max-w-[150px] rounded border border-border bg-card px-2 text-xs text-foreground"
              >
                <option value="">No team</option>
                {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
              </SelectControl>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 border-t border-border">
              <span className="text-muted-foreground">Active sender</span>
              <span className="font-medium text-foreground">
                {channelNumbers.find((n) => n.id === viewedThreadNumberId)?.label ?? activeNumber?.label ?? "WhatsApp"}
              </span>
            </div>
          </div>

          {/* Tags Card */}
          <div className="bg-card border-y border-border p-4 mt-2">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-foreground">Tags</h4>
              <button onClick={() => setTagMenu((o) => !o)} className="text-primary hover:text-primary/80" aria-label="Add tag">
                <Plus className="size-4" />
              </button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {activeTags.map((tag) => (
                <Badge key={tag} variant="secondary" className="gap-1 text-[11px]">
                  {tag}
                  <button type="button" onClick={() => void updateTag(tag, "remove_tag")} className="text-muted-foreground hover:text-destructive" aria-label={`Remove ${tag}`}>
                    ×
                  </button>
                </Badge>
              ))}
              {activeTags.length === 0 && <span className="text-xs text-muted-foreground">No tags</span>}
            </div>
            {tagMenu && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const t = newTag.trim();
                  if (!t || activeTags.includes(t)) return;
                  setNewTag("");
                  setTagMenu(false);
                  void updateTag(t, "add_tag");
                }}
                className="mt-2.5 flex gap-1.5"
              >
                <Input
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  placeholder="New tag..."
                  className="h-7 text-xs bg-muted/40 border-border"
                />
                <Button type="submit" size="sm" className="h-7 px-2.5 text-xs">
                  Add
                </Button>
              </form>
            )}
          </div>

          {/* Customer Activity Timeline */}
          <div className="bg-card border-y border-border p-4 mt-2 mb-6">
            <div className="flex items-center justify-between mb-2">
              <button
                type="button"
                onClick={() => setTimelineExpanded((e) => !e)}
                className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
              >
                Customer Timeline
                <ChevronDown className={cn("size-3.5 transition-transform", timelineExpanded ? "rotate-180" : "")} />
              </button>
              <span className="text-[10px] text-muted-foreground">Across numbers</span>
            </div>
            {timelineExpanded && (
              <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1 mt-2">
                {customerTimeline.map((item) => (
                  <div key={item.key} className="border-b border-border pb-2 text-xs">
                    <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
                      <span>{item.title}</span>
                      <span className="text-[10px] text-muted-foreground">{item.displayTime}</span>
                    </div>
                    <p className="mt-0.5 text-muted-foreground text-[11px] leading-relaxed truncate">{item.detail}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      )}
      </div>

      {/* Reroute Dialog */}
      <Dialog open={rerouteOpen} onOpenChange={(open) => { if (!rerouting) setRerouteOpen(open); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reroute conversation</DialogTitle>
            <DialogDescription>
              Choose the WhatsApp number for the new conversation thread. Existing messages stay under their original number.
            </DialogDescription>
          </DialogHeader>
          {activeChat && (
            <>
              <div className="rounded-lg border bg-muted/40 p-3 text-xs">
                <p className="text-muted-foreground">Current thread</p>
                <p className="mt-1 font-medium">{channelNumbers.find((number) => number.id === currentRouteNumberId)?.label ?? "WhatsApp"} · {channelNumbers.find((number) => number.id === currentRouteNumberId)?.number ?? "—"}</p>
              </div>
              <label className="flex flex-col gap-1.5 text-xs font-medium">
                Customer-facing sender
                <SelectControl value={rerouteTargetId} onChange={(event) => setRerouteTargetId(event.target.value)} className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground">
                  <option value="">Choose a number</option>
                  {senderNumbersForChat.filter((number) => number.id !== currentRouteNumberId).map((number) => (
                    <option key={number.id} value={number.id}>{number.label} · {number.number}</option>
                  ))}
                </SelectControl>
              </label>
            </>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={rerouting} onClick={() => setRerouteOpen(false)}>Cancel</Button>
            <Button disabled={rerouting || !rerouteTargetId} onClick={() => void rerouteConversation()}>
              {rerouting ? "Rerouting…" : "Confirm reroute"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Help Dialog */}
      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>WhatsApp CRM Help</DialogTitle>
            <DialogDescription>
              Quick guide to multi-number Twilio WhatsApp messaging.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-xs text-muted-foreground">
            <section>
              <h3 className="font-semibold text-foreground">Customer Service Window</h3>
              <p className="mt-1 leading-relaxed">
                Free-form replies are allowed within 24 hours of the customer’s latest message. When the window expires, you must send an approved template to re-open the conversation.
              </p>
            </section>
            <section>
              <h3 className="font-semibold text-foreground">Multi-Number Routing</h3>
              <p className="mt-1 leading-relaxed">
                You can switch between any of your configured Twilio WhatsApp numbers using the selector in the top bar. History remains organized per thread in the customer timeline.
              </p>
            </section>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function RailLink({ children, label, active = false, href }: { children: React.ReactNode; label: string; active?: boolean; href: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          aria-label={label}
          className={cn(
            "relative flex size-10 items-center justify-center rounded-xl transition-all duration-150",
            active ? "bg-primary text-primary-foreground shadow-xs font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
        >
          {children}
          <span className="sr-only">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="font-medium text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function RailButton({ children, label, active = false, onClick }: { children: React.ReactNode; label: string; active?: boolean; onClick?: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          aria-label={label}
          onClick={onClick}
          className={cn(
            "relative size-10 rounded-xl transition-all duration-150",
            active ? "bg-primary text-primary-foreground shadow-xs" : "text-muted-foreground hover:bg-muted hover:text-foreground"
          )}
          type="button"
          variant="ghost"
          size="icon"
        >
          {children}
          <span className="sr-only">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10} className="font-medium text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function ProfileRow({ label, value, dot }: { label: string; value: string; dot?: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-[11px] text-muted-foreground">{label}</span><span className="flex items-center gap-1.5 text-[11px] font-medium">{dot && <span className={`size-1.5 rounded-full ${dot}`} />}{value}</span></div>;
}
