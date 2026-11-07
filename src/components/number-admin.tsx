"use client";

import { SelectControl } from "@/components/ui/select-control";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  CircleAlert,
  Copy,
  Key,
  Pause,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
  Wifi,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export type TwilioAccountItem = {
  id: string;
  friendlyName: string;
  accountSid: string;
  numberCount: number;
};

type NumberItem = {
  id: string;
  label: string;
  number: string;
  provider?: "TWILIO" | "META";
  twilioAccountId?: string;
  twilioAccountSid?: string;
  twilioAccountName?: string;
  displayName?: string;
  metaPhoneNumberId?: string;
  metaWabaId?: string;
  qualitySignal?: string;
  allowedTeamIds?: string[];
  assignedUserId?: string | null;
  assignedUserName?: string | null;
  routingPriority?: number;
  lastStatusEventAt?: string;
  metaConnectionStatus?:
    | "CONNECTED"
    | "EXPIRING"
    | "EXPIRED"
    | "INACTIVE"
    | "UNLINKED"
    | "CONNECTION_MISSING"
    | "SERVER_TOKEN";
  metaTokenExpiresAt?: string | null;
  state: "Active" | "Pending approval" | "Paused" | "Degraded" | "Restricted" | "Disconnected" | "Archived";
};

export type MetaConnectionCheck = {
  busy?: boolean;
  outcome?: "PASSED" | "FAILED";
  checkedAt?: string;
  error?: string | null;
  verifiedName?: string | null;
  displayNumber?: string | null;
  numberMatches?: boolean | null;
  qualityRating?: string | null;
};

type TeamChoice = { id: string; name: string };
type SyncedTemplate = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  syncedAt: string;
  components: { type?: string; text?: string }[];
};

type MetaSdk = {
  init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
  login: (
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: {
      config_id: string;
      response_type: "code";
      override_default_response_type: boolean;
      extras: { setup: Record<string, never>; sessionInfoVersion: "3" };
    },
  ) => void;
};

declare global {
  interface Window {
    FB?: MetaSdk;
    fbAsyncInit?: () => void;
  }
}

export function NumberAdmin({
  initialNumbers,
  initialTwilioAccounts = [],
  initialConnectionChecks,
  liveSendingEnabled,
  publicAppUrl,
  initialAutoFailoverEnabled,
  initialNotificationTemplateId,
  initialFailoverMaxAttempts,
  initialFailoverCooldownMinutes,
  initialFailoverRequiresApproval,
}: {
  initialNumbers: NumberItem[];
  initialTwilioAccounts?: TwilioAccountItem[];
  initialConnectionChecks: Record<string, MetaConnectionCheck>;
  liveSendingEnabled: boolean;
  publicAppUrl: string;
  initialAutoFailoverEnabled: boolean;
  initialNotificationTemplateId: string | null;
  initialFailoverMaxAttempts: number;
  initialFailoverCooldownMinutes: number;
  initialFailoverRequiresApproval: boolean;
}) {
  const router = useRouter();
  const [numbers, setNumbers] = useState(initialNumbers);
  const [twilioAccounts, setTwilioAccounts] = useState<TwilioAccountItem[]>(initialTwilioAccounts);
  const [focusTarget, setFocusTarget] = useState<{ type: "number" | "waba"; id: string } | null>(null);
  const [teams, setTeams] = useState<TeamChoice[]>([]);
  const [teamMembers, setTeamMembers] = useState<{ id: string; name: string; role: string }[]>([]);
  const [teamAccessDraft, setTeamAccessDraft] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(initialNumbers.map((item) => [item.id, item.allowedTeamIds ?? []])),
  );

  // Form states
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");

  // Twilio number form states
  const [selectedTwilioAccountId, setSelectedTwilioAccountId] = useState<string>(
    initialTwilioAccounts[0]?.id || "new",
  );
  const [newTwilioAccountName, setNewTwilioAccountName] = useState("");
  const [newTwilioAccountSid, setNewTwilioAccountSid] = useState("");
  const [newTwilioAuthToken, setNewTwilioAuthToken] = useState("");
  const [twilioTesting, setTwilioTesting] = useState(false);

  // Separate Twilio account management dialog/section state
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [standaloneAccountName, setStandaloneAccountName] = useState("");
  const [standaloneAccountSid, setStandaloneAccountSid] = useState("");
  const [standaloneAuthToken, setStandaloneAuthToken] = useState("");
  const [standaloneTesting, setStandaloneTesting] = useState(false);

  // Meta states

  // Feedback states
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  // Failover settings
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState(initialAutoFailoverEnabled);
  const [failoverMaxAttempts, setFailoverMaxAttempts] = useState(initialFailoverMaxAttempts);
  const [failoverCooldownMinutes, setFailoverCooldownMinutes] = useState(initialFailoverCooldownMinutes);
  const [failoverRequiresApproval, setFailoverRequiresApproval] = useState(initialFailoverRequiresApproval);
  const [failoverBusy, setFailoverBusy] = useState(false);
  const [notificationTemplateId, setNotificationTemplateId] = useState(initialNotificationTemplateId ?? "");
  const [templates, setTemplates] = useState<SyncedTemplate[]>([]);

  // Editing states
  const [editingNumberId, setEditingNumberId] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [confirmLifecycle, setConfirmLifecycle] = useState<{ id: string; action: "pause" | "archive" } | null>(null);

  // Meta connection check states
  const [metaConfig, setMetaConfig] = useState<{
    configured: boolean;
    appId: string | null;
    configId: string | null;
    graphVersion: string;
    needsMfa: boolean;
    mfaMessage: string | null;
  }>({
    configured: false,
    appId: null,
    configId: null,
    graphVersion: "v26.0",
    needsMfa: false,
    mfaMessage: null,
  });
  const [metaSdkReady, setMetaSdkReady] = useState(false);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [connectionChecks, setConnectionChecks] = useState<Record<string, MetaConnectionCheck>>(initialConnectionChecks);

  const webhookUrl = `${publicAppUrl.replace(/\/$/, "")}/api/webhooks/twilio`;

  const copyWebhookUrl = () => {
    void navigator.clipboard.writeText(webhookUrl);
    setCopiedWebhook(true);
    setTimeout(() => setCopiedWebhook(false), 2500);
  };

  useEffect(() => {
    let disposed = false;
    void Promise.all([
      fetch("/api/teams", { cache: "no-store" }).then((res) => res.json()),
      fetch("/api/team", { cache: "no-store" }).then((res) => res.json()),
    ]).then(([teamsData, teamData]) => {
      if (!disposed && Array.isArray(teamsData?.teams)) setTeams(teamsData.teams);
      if (!disposed && Array.isArray(teamData?.team)) setTeamMembers(teamData.team);
    }).catch(() => {});
    return () => {
      disposed = true;
    };
  }, []);

  const assignAgent = async (item: NumberItem, userId: string | null) => {
    setError(""); setNotice("");
    try {
      const res = await fetch(`/api/numbers/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "assign_user", assignedUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update agent assignment.");
      if (data.numbers) setNumbers(data.numbers);
      setNotice(userId ? `Assigned ${item.label} exclusively to agent.` : `Returned ${item.label} to unassigned pool.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update agent assignment.");
    }
  };

  const refreshAccounts = async () => {
    try {
      const res = await fetch("/api/numbers/twilio/accounts", { cache: "no-store" });
      const data = await res.json();
      if (res.ok && Array.isArray(data.accounts)) {
        setTwilioAccounts(data.accounts);
      }
    } catch {}
  };

  async function handleAddTwilioAccount(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setStandaloneTesting(true);

    try {
      const res = await fetch("/api/numbers/twilio/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          friendlyName: standaloneAccountName,
          accountSid: standaloneAccountSid,
          authToken: standaloneAuthToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save Twilio account.");

      setNotice(`Twilio account "${data.account.friendlyName}" connected successfully.`);
      setStandaloneAccountName("");
      setStandaloneAccountSid("");
      setStandaloneAuthToken("");
      setShowAddAccountModal(false);
      await refreshAccounts();
      setSelectedTwilioAccountId(data.account.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add Twilio account.");
    } finally {
      setStandaloneTesting(false);
    }
  }

  async function addNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);

    try {
      const payload: Record<string, unknown> = {
        label,
        number,
        provider: "TWILIO",
      };

      if (selectedTwilioAccountId && selectedTwilioAccountId !== "new") {
        payload.twilioAccountId = selectedTwilioAccountId;
      } else {
        payload.twilioAccountName = newTwilioAccountName;
        payload.twilioAccountSid = newTwilioAccountSid;
        payload.twilioAuthToken = newTwilioAuthToken;
      }

      const response = await fetch("/api/numbers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add number.");

      setNumbers((current) => [...current, data.number]);
      setLabel("");
      setNumber("");
      setNewTwilioAccountName("");
      setNewTwilioAccountSid("");
      setNewTwilioAuthToken("");

      await refreshAccounts();
      setNotice(`Twilio WhatsApp number ${data.number.number} added. Set the inbound and status webhook URLs in Twilio Console.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add number.");
    } finally {
      setBusy(false);
    }
  }

  async function updateNumber(
    item: NumberItem,
    action: "approve" | "pause" | "activate" | "archive" | "rename" | "move_up" | "move_down" | "set_allowed_teams",
    renameLabel?: string,
    allowedTeams?: string[],
  ) {
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/numbers/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, label: renameLabel, allowedTeamIds: allowedTeams }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update number.");

      if (data.numbers) {
        setNumbers(data.numbers);
      } else {
        setNumbers((current) => current.map((entry) => (entry.id === item.id ? data.number : entry)));
      }
      setEditingNumberId("");
      setConfirmLifecycle(null);
      setNotice(
        action === "approve"
          ? "Number approved in this CRM."
          : action === "pause"
          ? "Number paused."
          : action === "activate"
          ? "Number reactivated."
          : action === "archive"
          ? "Number archived."
          : action === "rename"
          ? "Label updated."
          : "Updated successfully.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update number.");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">WhatsApp numbers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage approved senders, Twilio accounts, and inbox routing.
          </p>
        </div>
        <Badge variant="success" className="gap-1.5 py-1 px-3">
          <Wifi className="size-3.5" />
          Twilio Ready · Multi-Account
        </Badge>
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          { label: "Active senders", value: numbers.filter((item) => item.state === "Active" && (item.provider === "TWILIO" || (!item.metaPhoneNumberId && !item.metaWabaId))).length, detail: "Available to your inbox team" },
          { label: "Twilio accounts", value: twilioAccounts.length, detail: "Credential sets connected" },
          { label: "Paused senders", value: numbers.filter((item) => item.state === "Paused").length, detail: "Not currently selected for messaging" },
        ].map((metric) => (
          <Card key={metric.label} className="border-border/80 shadow-xs">
            <CardContent className="p-4">
              <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
              <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">{metric.value}</p>
              <p className="mt-1 text-[11px] text-muted-foreground">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </div>

        {notice && (
          <div role="status" className="mb-4 rounded-lg border border-border bg-accent/30 px-4 py-3 text-sm text-foreground">
            {notice}
          </div>
        )}
        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Twilio Webhook Instruction Callout */}
        <Card className="mb-6 border-primary/20 bg-muted/30">
          <CardContent className="p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Server className="size-4" />
                  </div>
                  <h2 className="text-sm font-semibold text-foreground">Twilio WhatsApp Webhook Configuration</h2>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground max-w-2xl">
                  For each WhatsApp sender, set <em>&quot;WHEN A MESSAGE COMES IN&quot;</em> to this CRM URL using <strong>HTTP POST</strong>. Set its status callback to <code>/api/webhooks/twilio/status</code> as well. The public URL must match the app&apos;s <code>APP_BASE_URL</code> exactly:
                </p>
                <div className="mt-3 flex items-center gap-2 max-w-xl">
                  <code className="flex-1 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-mono font-medium text-foreground select-all">
                    {webhookUrl}
                  </code>
                  <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={copyWebhookUrl}>
                    {copiedWebhook ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                    {copiedWebhook ? "Copied!" : "Copy URL"}
                  </Button>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                onClick={() => setShowAddAccountModal(true)}
              >
                <Key className="mr-1.5 size-3.5" />
                Manage Twilio Accounts ({twilioAccounts.length})
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Modal/Box for Managing Twilio Accounts */}
        {showAddAccountModal && (
          <Card className="mb-6">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold">Twilio Accounts ({twilioAccounts.length})</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Save credentials for each Twilio account you want to route WhatsApp numbers through.
                  </CardDescription>
                </div>
                <Button size="icon" variant="ghost" onClick={() => setShowAddAccountModal(false)}>
                  <X className="size-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent>
              {twilioAccounts.length > 0 && (
                <div className="divide-y rounded-xl border bg-muted/20">
                  {twilioAccounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between p-3 text-xs">
                      <div>
                        <div className="font-semibold text-foreground">{acc.friendlyName}</div>
                        <div className="text-muted-foreground font-mono text-[11px]">{acc.accountSid}</div>
                      </div>
                      <Badge variant="secondary">{acc.numberCount} number{acc.numberCount === 1 ? "" : "s"}</Badge>
                    </div>
                  ))}
                </div>
              )}

              <form onSubmit={handleAddTwilioAccount} className="mt-4 border-t pt-4">
                <h4 className="text-xs font-semibold text-foreground mb-2">Connect Another Twilio Account</h4>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-xs text-foreground">
                    Account Name / Label
                    <Input
                      required
                      placeholder="e.g. Sales Account, US Line"
                      value={standaloneAccountName}
                      onChange={(e) => setStandaloneAccountName(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-foreground">
                    Twilio Account SID
                    <Input
                      required
                      placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                      value={standaloneAccountSid}
                      onChange={(e) => setStandaloneAccountSid(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-foreground">
                    Twilio Auth Token
                    <Input
                      required
                      type="password"
                      placeholder="Auth Token"
                      value={standaloneAuthToken}
                      onChange={(e) => setStandaloneAuthToken(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </label>
                </div>
                <div className="mt-3 flex justify-end gap-2">
                  <Button size="sm" type="button" variant="ghost" onClick={() => setShowAddAccountModal(false)}>
                    Cancel
                  </Button>
                  <Button size="sm" type="submit" disabled={standaloneTesting}>
                    {standaloneTesting ? "Verifying with Twilio…" : "Test & Save Account"}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        {/* Connected Sender Numbers List */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4">
            <div>
              <h2 className="text-sm font-semibold">Configured WhatsApp Numbers</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Active numbers can send and receive WhatsApp messages in the shared inbox.
              </p>
            </div>
            <Badge variant="secondary">{numbers.filter((number) => number.provider === "TWILIO").length} Twilio senders</Badge>
          </div>
          <Separator />
          <div className="divide-y">
            {numbers.length === 0 ? (
              <div className="p-8 text-center text-xs text-muted-foreground">
                No numbers configured yet. Add your first Twilio WhatsApp number below!
              </div>
            ) : (
              numbers.map((item, index) => {
                const isTwilio = item.provider === "TWILIO" || (!item.metaPhoneNumberId && !item.metaWabaId);
                return (
                  <div id={`channel-number-${item.id}`} key={item.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                    <div
                      className={`flex size-10 items-center justify-center rounded-xl ${
                        item.state === "Active" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                      }`}
                    >
                      <Phone className="size-4" />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      {editingNumberId === item.id ? (
                        <form
                          className="flex max-w-sm gap-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void updateNumber(item, "rename", editingLabel);
                          }}
                        >
                          <Input
                            autoFocus
                            aria-label="Sender number label"
                            maxLength={80}
                            value={editingLabel}
                            onChange={(event) => setEditingLabel(event.target.value)}
                            className="h-8 text-xs"
                          />
                          <Button size="sm" type="submit">
                            Save
                          </Button>
                          <Button size="icon" variant="ghost" type="button" onClick={() => setEditingNumberId("")}>
                            <X className="size-4" />
                          </Button>
                        </form>
                      ) : (
                        <div className="flex items-center gap-2">
                          <div className="text-sm font-semibold">{item.label}</div>
                          <Badge variant={isTwilio ? "secondary" : "outline"} className="text-[10px] px-1.5 py-0 h-4">
                            {isTwilio ? "Twilio" : "Unavailable · legacy"}
                          </Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-7"
                            title="Rename"
                            onClick={() => {
                              setEditingNumberId(item.id);
                              setEditingLabel(item.label);
                            }}
                          >
                            <Pencil className="size-3.5" />
                          </Button>
                        </div>
                      )}
                      <div className="mt-0.5 text-xs font-mono font-medium text-gray-800">{item.number}</div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {isTwilio ? (
                          <span>
                            Twilio Account:{" "}
                            <strong>
                              {item.twilioAccountName || (item.twilioAccountSid ? `${item.twilioAccountSid.slice(0, 8)}...` : "Default")}
                            </strong>
                          </span>
                        ) : (
                          <span>Unavailable for sending while Twilio only mode is enabled</span>
                        )}
                        {" · "}Priority {index + 1}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-[11px] text-muted-foreground hidden sm:inline">Assigned:</span>
                        <SelectControl
                          aria-label={`Assigned agent for ${item.label}`}
                          value={item.assignedUserId ?? ""}
                          disabled={item.state === "Archived"}
                          onChange={(event) => void assignAgent(item, event.target.value || null)}
                          className="h-8 rounded-md border border-border bg-card px-2 text-xs max-w-[150px]"
                        >
                          <option value="">Pool (Shared)</option>
                          {teamMembers.map((member) => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                          ))}
                        </SelectControl>
                      </div>
                      <Badge
                        variant={item.state === "Active" ? "success" : item.state === "Paused" ? "outline" : "warning"}
                        className="gap-1.5"
                      >
                        {item.state === "Active" ? <Wifi className="size-3" /> : <Pause className="size-3" />}
                        {item.state}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={index === 0 || item.state === "Archived"}
                        onClick={() => updateNumber(item, "move_up")}
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={index === numbers.length - 1 || item.state === "Archived"}
                        onClick={() => updateNumber(item, "move_down")}
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                      {item.state === "Pending approval" && (
                        <Button size="sm" onClick={() => updateNumber(item, "approve")}>
                          <Check data-icon="inline-start" />
                          Approve
                        </Button>
                      )}
                      {(item.state === "Paused" || item.state === "Disconnected") && (
                        <Button variant="outline" size="sm" onClick={() => updateNumber(item, "activate")}>
                          Activate
                        </Button>
                      )}
                      {item.state === "Active" && (
                        <Button variant="outline" size="sm" onClick={() => setConfirmLifecycle({ id: item.id, action: "pause" })}>
                          Pause
                        </Button>
                      )}
                      {item.state !== "Archived" && (
                        <Button variant="ghost" size="sm" onClick={() => setConfirmLifecycle({ id: item.id, action: "archive" })}>
                          <Archive data-icon="inline-start" />
                          Archive
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Card>

        {/* Add Number Section */}
        <Card className="mt-6">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Plus className="size-4" />
                </div>
                <div>
                  <CardTitle className="text-sm font-semibold">Add WhatsApp Number</CardTitle>
                  <CardDescription className="text-xs">
                    Add an approved Twilio WhatsApp sender to this workspace.
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>

          <form onSubmit={addNumber} className="grid gap-4 md:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Display Label
              <Input
                required
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder="e.g. Sales Team US, Support Line"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-medium">
              Phone number in international format
              <Input
                required
                type="tel"
                value={number}
                onChange={(event) => setNumber(event.target.value)}
                placeholder="+14155550123"
              />
            </label>

                <div className="md:col-span-2">
                  <label className="flex flex-col gap-1.5 text-xs font-medium">
                    Twilio Account
                    <SelectControl
                      value={selectedTwilioAccountId}
                      onChange={(e) => setSelectedTwilioAccountId(e.target.value)}
                      className="h-9 rounded-lg border bg-white px-3 text-xs outline-none focus-visible:ring-2"
                    >
                      {twilioAccounts.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.friendlyName} ({acc.accountSid.slice(0, 8)}...)
                        </option>
                      ))}
                      <option value="new">+ Connect a different / new Twilio Account</option>
                    </SelectControl>
                  </label>
                </div>

                {selectedTwilioAccountId === "new" && (
                  <>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Account Friendly Name
                      <Input
                        required
                        value={newTwilioAccountName}
                        onChange={(e) => setNewTwilioAccountName(e.target.value)}
                        placeholder="e.g. Agency Main, UK Twilio"
                      />
                    </label>
                    <label className="flex flex-col gap-1.5 text-xs font-medium">
                      Twilio Account SID
                      <Input
                        required
                        value={newTwilioAccountSid}
                        onChange={(e) => setNewTwilioAccountSid(e.target.value)}
                        placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                        className="font-mono text-xs"
                      />
                    </label>
                    <label className="md:col-span-2 flex flex-col gap-1.5 text-xs font-medium">
                      Twilio Auth Token
                      <Input
                        required
                        type="password"
                        value={newTwilioAuthToken}
                        onChange={(e) => setNewTwilioAuthToken(e.target.value)}
                        placeholder="Enter Auth Token from Twilio Console"
                        className="font-mono text-xs"
                      />
                    </label>
                  </>
                )}

            <div className="md:col-span-2 flex justify-end mt-2">
              <Button type="submit" disabled={busy} className="bg-primary">
                <Plus data-icon="inline-start" />
                {busy ? "Adding Number…" : "Add WhatsApp Number"}
              </Button>
            </div>
          </form>
          </CardContent>
        </Card>

        {/* Team Access */}
        <Card className="mt-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Sender Number Team Access</CardTitle>
            <CardDescription className="text-xs">
              Restrict which teams can send from each number. If none are selected, all workspace agents can use it.
            </CardDescription>
          </CardHeader>
          <CardContent>
          {teams.length === 0 ? (
            <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
              No teams created yet. You can create teams in Admin → Team.
            </p>
          ) : (
            <div className="flex flex-col divide-y">
              {numbers
                .filter((item) => item.state !== "Archived")
                .map((item) => {
                  const selected = teamAccessDraft[item.id] ?? item.allowedTeamIds ?? [];
                  return (
                    <div key={item.id} className="flex flex-wrap items-center gap-3 py-3">
                      <div className="min-w-40 flex-1">
                        <p className="text-xs font-medium">{item.label}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {selected.length ? `${selected.length} team(s) assigned` : "Available to all teams"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {teams.map((team) => (
                          <Button
                            key={team.id}
                            type="button"
                            size="sm"
                            variant={selected.includes(team.id) ? "secondary" : "outline"}
                            className="h-7 px-2 text-[10px]"
                            onClick={() =>
                              setTeamAccessDraft((current) => ({
                                ...current,
                                [item.id]: selected.includes(team.id)
                                  ? selected.filter((id) => id !== team.id)
                                  : [...selected, team.id],
                              }))
                            }
                          >
                            {team.name}
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={JSON.stringify(selected) === JSON.stringify(item.allowedTeamIds ?? [])}
                        onClick={() => void updateNumber(item, "set_allowed_teams", undefined, selected)}
                      >
                        Save access
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
          </CardContent>
        </Card>
    </div>
  );
}
