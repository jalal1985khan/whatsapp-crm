"use client";

import { SelectControl } from "@/components/ui/select-control";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Archive, ArrowDown, ArrowLeft, ArrowUp, Check, CircleAlert, LogOut, MessageCircle, Pause, Pencil, Phone, Plus, RefreshCw, ShieldCheck, Wifi, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

type NumberItem = { id: string; label: string; number: string; displayName?: string; metaPhoneNumberId?: string; metaWabaId?: string; qualitySignal?: string; allowedTeamIds?: string[]; routingPriority?: number; lastStatusEventAt?: string; metaConnectionStatus?: "CONNECTED" | "EXPIRING" | "EXPIRED" | "INACTIVE" | "UNLINKED" | "CONNECTION_MISSING" | "SERVER_TOKEN"; metaTokenExpiresAt?: string | null; state: "Active" | "Pending approval" | "Paused" | "Degraded" | "Restricted" | "Disconnected" | "Archived" };
export type MetaConnectionCheck = { busy?: boolean; outcome?: "PASSED" | "FAILED"; checkedAt?: string; error?: string | null; verifiedName?: string | null; displayNumber?: string | null; numberMatches?: boolean | null; qualityRating?: string | null };
type TeamChoice = { id: string; name: string };
type SyncedTemplate = { id: string; name: string; language: string; category: string; status: string; syncedAt: string; components: { type?: string; text?: string }[] };
type MetaSdk = { init: (options: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void; login: (callback: (response: { authResponse?: { code?: string } }) => void, options: { config_id: string; response_type: "code"; override_default_response_type: boolean; extras: { setup: Record<string, never>; sessionInfoVersion: "3" } }) => void };
declare global { interface Window { FB?: MetaSdk; fbAsyncInit?: () => void } }
function transitionTemplateEligible(template: SyncedTemplate) {
  if (template.status !== "APPROVED" || template.category.toUpperCase() !== "UTILITY" || Date.now() - new Date(template.syncedAt).getTime() > 24 * 60 * 60 * 1000) return false;
  const body = template.components.find((component) => component.type?.toUpperCase() === "BODY");
  const vars = [...new Set([...(body?.text ?? "").matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1]))];
  const otherVars = template.components.some((component) => component !== body && typeof component.text === "string" && /\{\{[^}]+\}\}/.test(component.text));
  const validSingleVariable = vars.length === 1 && (/^\d+$/.test(vars[0]) && vars[0] === "1" || /^[a-z][a-z0-9_]*$/.test(vars[0]));
  return validSingleVariable && !otherVars;
}

export function NumberAdmin({ initialNumbers, initialConnectionChecks, liveSendingEnabled, initialAutoFailoverEnabled, initialNotificationTemplateId, initialFailoverMaxAttempts, initialFailoverCooldownMinutes, initialFailoverRequiresApproval }: { initialNumbers: NumberItem[]; initialConnectionChecks: Record<string, MetaConnectionCheck>; liveSendingEnabled: boolean; initialAutoFailoverEnabled: boolean; initialNotificationTemplateId: string | null; initialFailoverMaxAttempts: number; initialFailoverCooldownMinutes: number; initialFailoverRequiresApproval: boolean }) {
  const router = useRouter();
  const [numbers, setNumbers] = useState(initialNumbers);
  const [focusTarget, setFocusTarget] = useState<{ type: "number" | "waba"; id: string } | null>(null);
  const [teams, setTeams] = useState<TeamChoice[]>([]);
  const [teamAccessDraft, setTeamAccessDraft] = useState<Record<string, string[]>>(() => Object.fromEntries(initialNumbers.map((item) => [item.id, item.allowedTeamIds ?? []])));
  const [label, setLabel] = useState("");
  const [number, setNumber] = useState("");
  const [metaPhoneNumberId, setMetaPhoneNumberId] = useState("");
  const [metaWabaId, setMetaWabaId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [autoFailoverEnabled, setAutoFailoverEnabled] = useState(initialAutoFailoverEnabled);
  const [failoverMaxAttempts, setFailoverMaxAttempts] = useState(initialFailoverMaxAttempts);
  const [failoverCooldownMinutes, setFailoverCooldownMinutes] = useState(initialFailoverCooldownMinutes);
  const [failoverRequiresApproval, setFailoverRequiresApproval] = useState(initialFailoverRequiresApproval);
  const [failoverBusy, setFailoverBusy] = useState(false);
  const [notificationTemplateId, setNotificationTemplateId] = useState(initialNotificationTemplateId ?? "");
  const [templates, setTemplates] = useState<SyncedTemplate[]>([]);
  const [editingNumberId, setEditingNumberId] = useState("");
  const [editingLabel, setEditingLabel] = useState("");
  const [confirmLifecycle, setConfirmLifecycle] = useState<{ id: string; action: "pause" | "archive" } | null>(null);
  const [metaConfig, setMetaConfig] = useState<{ configured: boolean; appId: string | null; configId: string | null; graphVersion: string; needsMfa: boolean; mfaMessage: string | null }>({ configured: false, appId: null, configId: null, graphVersion: "v26.0", needsMfa: false, mfaMessage: null });
  const [metaSdkReady, setMetaSdkReady] = useState(false);
  const [metaConnecting, setMetaConnecting] = useState(false);
  const [connectionChecks, setConnectionChecks] = useState<Record<string, MetaConnectionCheck>>(initialConnectionChecks);
  const signupCode = useRef("");
  const signupWaba = useRef("");
  const metaConnectInFlight = useRef(false);
  const eligibleNoticeTemplates = templates.filter(transitionTemplateEligible);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const numberId = params.get("number");
    const wabaId = params.get("waba");
    if (numberId) setFocusTarget({ type: "number", id: numberId });
    else if (wabaId) setFocusTarget({ type: "waba", id: wabaId });
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    const target = numbers.find((item) => focusTarget.type === "number" ? item.id === focusTarget.id : item.metaWabaId === focusTarget.id);
    if (!target) return;
    const timeout = window.setTimeout(() => document.getElementById(`channel-number-${target.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
    return () => window.clearTimeout(timeout);
  }, [focusTarget, numbers]);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let refreshing = false;
    const isHidden = () => document.visibilityState === "hidden";
    const refreshNumbers = async () => {
      if (disposed || refreshing || isHidden()) return;
      refreshing = true;
      try {
        const response = await fetch("/api/numbers", { cache: "no-store" });
        const data = await response.json();
        if (!disposed && response.ok && Array.isArray(data.numbers)) setNumbers(data.numbers);
      } catch { /* Keep the last server-confirmed status if a refresh temporarily fails. */ }
      finally {
        refreshing = false;
        if (!disposed && !isHidden()) timer = window.setTimeout(() => void refreshNumbers(), 60_000);
      }
    };
    const handleVisibilityChange = () => {
      if (isHidden()) {
        if (timer) window.clearTimeout(timer);
        timer = undefined;
      } else {
        if (timer) window.clearTimeout(timer);
        timer = undefined;
        void refreshNumbers();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    timer = window.setTimeout(() => void refreshNumbers(), 60_000);
    return () => { disposed = true; document.removeEventListener("visibilitychange", handleVisibilityChange); if (timer) window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/teams", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (!disposed && Array.isArray(data.teams)) setTeams(data.teams.map((team: TeamChoice) => ({ id: team.id, name: team.name })));
    }).catch(() => { /* Team restrictions remain unavailable until teams load. */ });
    return () => { disposed = true; };
  }, []);

  const completeMetaSignup = useCallback(async (code: string, wabaId: string) => {
    if (!code || !wabaId || metaConnectInFlight.current) return;
    metaConnectInFlight.current = true;
    setMetaConnecting(true); setError(""); setNotice("Connecting the selected WhatsApp business account and checking its phone numbers…");
    try {
      const response = await fetch("/api/numbers/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, wabaId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not connect this Meta business account.");
      if (Array.isArray(data.numbers)) setNumbers(data.numbers);
      const connected = Array.isArray(data.connected) ? data.connected as { state?: string }[] : [];
      const pendingApproval = connected.filter((number) => String(number.state).toUpperCase() === "PENDING").length;
      const reactivationNeeded = connected.filter((number) => ["DISCONNECTED", "PAUSED"].includes(String(number.state).toUpperCase())).length;
      const followUp = [pendingApproval ? `${pendingApproval} new number${pendingApproval === 1 ? "" : "s"} need admin approval` : "", reactivationNeeded ? `${reactivationNeeded} previously approved number${reactivationNeeded === 1 ? "" : "s"} need reactivation` : ""].filter(Boolean).join("; ");
      setNotice(`Meta connection saved and ${connected.length} number${connected.length === 1 ? "" : "s"} synced. Existing CRM history and assignments are preserved.${followUp ? ` ${followUp}.` : " Review sender status before routing messages."}`);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not connect this Meta business account."); setNotice(""); }
    finally { setMetaConnecting(false); metaConnectInFlight.current = false; signupCode.current = ""; signupWaba.current = ""; }
  }, [router]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/numbers/connect", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (!disposed) setMetaConfig({ configured: Boolean(data.configured), appId: data.appId ?? null, configId: data.configId ?? null, graphVersion: data.graphVersion || "v26.0", needsMfa: Boolean(data.needsMfa), mfaMessage: typeof data.mfaMessage === "string" ? data.mfaMessage : null });
      if (!data.configured || !data.appId || !data.configId) return;
      const initialize = () => {
        if (!window.FB) return;
        window.FB.init({ appId: data.appId, cookie: true, xfbml: false, version: data.graphVersion || "v26.0" });
        if (!disposed) setMetaSdkReady(true);
      };
      if (window.FB) initialize();
      else {
        window.fbAsyncInit = initialize;
        let script = document.getElementById("facebook-jssdk") as HTMLScriptElement | null;
        if (!script) { script = document.createElement("script"); script.id = "facebook-jssdk"; script.async = true; script.defer = true; script.src = "https://connect.facebook.net/en_US/sdk.js"; script.onerror = () => { if (!disposed) setError("Could not load the Meta sign-up SDK. Check the browser network connection and allowed Meta domains."); }; document.head.appendChild(script); }
      }
    }).catch(() => { if (!disposed) setError("Could not load Meta onboarding configuration."); });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    function receiveMetaEvent(event: MessageEvent) {
      if (!["https://www.facebook.com", "https://web.facebook.com", "https://business.facebook.com"].includes(event.origin)) return;
      let data: { type?: string; event?: string; data?: { waba_id?: string } };
      try { data = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return; }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (data.event === "CANCEL" || data.event === "ERROR") { setError(data.event === "CANCEL" ? "Meta sign-up was canceled." : "Meta could not complete sign-up. Review the business account and try again."); setNotice(""); signupCode.current = ""; signupWaba.current = ""; return; }
      if (data.event === "FINISH" && data.data?.waba_id && /^\d{5,30}$/.test(data.data.waba_id)) {
        signupWaba.current = data.data.waba_id;
        if (signupCode.current) void completeMetaSignup(signupCode.current, signupWaba.current);
      }
    }
    window.addEventListener("message", receiveMetaEvent);
    return () => window.removeEventListener("message", receiveMetaEvent);
  }, [completeMetaSignup]);

  useEffect(() => {
    let disposed = false;
    void fetch("/api/templates", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      if (!disposed && Array.isArray(data.templates)) setTemplates(data.templates);
    }).catch(() => { /* Template selection is optional until Meta is connected. */ });
    return () => { disposed = true; };
  }, []);

  async function addNumber(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const response = await fetch("/api/numbers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, number, metaPhoneNumberId, metaWabaId }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add number.");
      setNumbers((current) => [...current, data.number]); setLabel(""); setNumber(""); setMetaPhoneNumberId(""); setMetaWabaId("");
      setNotice("Number added as pending approval. Activate it only after Meta onboarding is complete.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add number."); }
    finally { setBusy(false); }
  }

  function startMetaSignup() {
    if (!window.FB || !metaConfig.configId) { setError("Meta Embedded Signup is not ready. Refresh the page and try again."); return; }
    setError(""); setNotice("Complete the Meta business sign-up window. The CRM will verify the account and import its phone numbers when you finish.");
    signupCode.current = ""; signupWaba.current = "";
    window.FB.login((response) => {
      const code = response.authResponse?.code;
      if (!code) { if (!signupWaba.current) { setNotice(""); setError("Meta sign-up did not return an authorization code. Try again or review the Meta app configuration."); } return; }
      signupCode.current = code;
      if (signupWaba.current) void completeMetaSignup(code, signupWaba.current);
    }, { config_id: metaConfig.configId, response_type: "code", override_default_response_type: true, extras: { setup: {}, sessionInfoVersion: "3" } });
  }

  async function updateNumber(item: NumberItem, action: "approve" | "pause" | "activate" | "archive" | "rename" | "move_up" | "move_down" | "set_allowed_teams", nextLabel?: string, allowedTeamIds?: string[]) {
    setError(""); setNotice("");
    const response = await fetch(`/api/numbers/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, label: nextLabel, allowedTeamIds }) });
    const data = await response.json();
    if (data.metaCheck) setConnectionChecks((current) => ({ ...current, [item.id]: { busy: false, outcome: data.metaCheck.outcome, checkedAt: new Date().toISOString(), error: data.metaCheck.error, verifiedName: data.metaCheck.verifiedName, displayNumber: data.metaCheck.displayNumber, numberMatches: data.metaCheck.numberMatches, qualityRating: data.metaCheck.qualityRating } }));
    if (!response.ok) { setError(data.error || "Could not update number."); return; }
    if (data.numbers) setNumbers(data.numbers);
    else setNumbers((current) => current.map((entry) => entry.id === item.id ? data.number : entry));
    setEditingNumberId(""); setConfirmLifecycle(null);
    setNotice(action === "approve" ? "Meta asset mapping verified and number approved in this CRM. This read-only check does not confirm live message-sending eligibility." : action === "pause" || action === "activate" || action === "archive" ? action === "activate" ? "Meta asset mapping verified and number reactivated. Confirm webhook and send status before routing live traffic." : `Number ${action === "archive" ? "archived" : "paused"}.` : action === "rename" ? "Sender number label updated." : action === "set_allowed_teams" ? "Sender-number team access updated." : "Sender-number priority updated.");
  }

  async function checkMetaNumber(item: NumberItem) {
    setConnectionChecks((current) => ({ ...current, [item.id]: { ...current[item.id], busy: true, error: null } }));
    try {
      const response = await fetch(`/api/numbers/${encodeURIComponent(item.id)}/health`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check the Meta number.");
      setConnectionChecks((current) => ({ ...current, [item.id]: { busy: false, outcome: data.outcome, checkedAt: data.checkedAt, error: data.error, verifiedName: data.verifiedName, displayNumber: data.displayNumber, numberMatches: data.numberMatches, qualityRating: data.qualityRating } }));
    } catch (cause) {
      setConnectionChecks((current) => ({ ...current, [item.id]: { busy: false, outcome: "FAILED", checkedAt: new Date().toISOString(), error: cause instanceof Error ? cause.message : "Could not check the Meta number." } }));
    }
  }

  async function logout() { await fetch("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }

  async function updateFailoverSetting(enabled: boolean, maxAttempts = failoverMaxAttempts, requiresApproval = failoverRequiresApproval, cooldownMinutes = failoverCooldownMinutes) {
    setFailoverBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/failover-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, notificationTemplateId: notificationTemplateId || null, maxAttempts, requiresApproval, cooldownMinutes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update failover setting.");
      setAutoFailoverEnabled(Boolean(data.enabled));
      setFailoverMaxAttempts(Number(data.maxAttempts ?? 1));
      setFailoverCooldownMinutes(Number(data.cooldownMinutes ?? 60));
      setFailoverRequiresApproval(Boolean(data.requiresApproval));
      setNotificationTemplateId(data.notificationTemplateId ?? "");
      setNotice(data.enabled ? "Guarded failover enabled for confirmed number-unregistered errors only." : "Automatic failover disabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update failover setting."); }
    finally { setFailoverBusy(false); }
  }

  async function updateTransitionTemplate(value: string) {
    setFailoverBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/failover-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: autoFailoverEnabled, notificationTemplateId: value || null, maxAttempts: failoverMaxAttempts, requiresApproval: failoverRequiresApproval, cooldownMinutes: failoverCooldownMinutes }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update the number-change notice.");
      setNotificationTemplateId(data.notificationTemplateId ?? "");
      setNotice(value ? "Approved number-change template saved. It will be used only after a successful guarded failover." : "Automatic customer number-change notice disabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update the number-change notice."); }
    finally { setFailoverBusy(false); }
  }

  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-xl bg-primary text-white"><MessageCircle className="size-4" /></div><span className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Admin</span></span></div><div className="flex items-center gap-3"><Link href="/admin/routing" className="text-sm text-muted-foreground hover:text-foreground">Routing</Link><Link href="/admin/team" className="text-sm text-muted-foreground hover:text-foreground">Team</Link><Link href="/admin/templates" className="text-sm text-muted-foreground hover:text-foreground">Templates</Link><Link href="/admin/replies" className="text-sm text-muted-foreground hover:text-foreground">Saved replies</Link><Link href="/admin/webhooks" className="text-sm text-muted-foreground hover:text-foreground">Webhook health</Link><Link href="/admin/audit" className="text-sm text-muted-foreground hover:text-foreground">Audit history</Link><Link href="/admin/alerts" className="text-sm text-muted-foreground hover:text-foreground">Alerts</Link><Link href="/admin/privacy" className="text-sm text-muted-foreground hover:text-foreground">Privacy</Link><Link href="/account/security" className="text-sm text-muted-foreground hover:text-foreground">Security</Link><Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Open inbox</Link><Button variant="ghost" size="sm" onClick={logout}><LogOut data-icon="inline-start" />Sign out</Button></div></header>
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <Link href="/" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to inbox</Link>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">WhatsApp numbers</h1><p className="mt-1 text-sm text-muted-foreground">Manage sender identities available to your CRM team.</p></div><Badge variant={liveSendingEnabled ? "success" : "warning"} title={liveSendingEnabled ? "Credentials are configured, but this does not verify Meta access or number readiness." : "Configure PostgreSQL and a Meta access token or connect a Meta business account."} className="gap-1.5">{liveSendingEnabled ? <Wifi className="size-3.5" /> : <CircleAlert className="size-3.5" />}{liveSendingEnabled ? "Meta credentials configured · not verified" : "Cloud API setup required"}</Badge></div>
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex items-center justify-between px-5 py-4"><div><h2 className="text-sm font-semibold">Connected sender numbers</h2><p className="mt-1 text-xs text-muted-foreground">Only active, approved numbers appear in the inbox sender menu.</p></div><Badge variant="secondary">{numbers.length} total</Badge></div>
        <Separator />
        <div className="divide-y">{numbers.map((item, index) => <div id={`channel-number-${item.id}`} key={item.id} className={cn("flex flex-wrap items-center gap-3 px-5 py-4", focusTarget && (focusTarget.type === "number" ? focusTarget.id === item.id : focusTarget.id === item.metaWabaId) && "rounded-lg bg-primary/5 ring-2 ring-primary ring-offset-2") }><div className={`flex size-10 items-center justify-center rounded-xl ${item.state === "Active" ? "bg-[#eaf4ed] text-primary" : "bg-amber-50 text-amber-700"}`}><Phone className="size-4" /></div><div className="min-w-[180px] flex-1">{editingNumberId === item.id ? <form className="flex max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); void updateNumber(item, "rename", editingLabel); }}><Input autoFocus aria-label="Sender number label" maxLength={80} value={editingLabel} onChange={(event) => setEditingLabel(event.target.value)} className="h-8 text-xs" /><Button size="sm" type="submit">Save</Button><Button size="icon" variant="ghost" type="button" aria-label="Cancel label edit" onClick={() => setEditingNumberId("")}><X className="size-4" /></Button></form> : <div className="flex items-center gap-2"><div className="text-sm font-medium">{item.label}</div><Button variant="ghost" size="icon" className="size-7" aria-label={`Rename ${item.label}`} title="Rename" onClick={() => { setEditingNumberId(item.id); setEditingLabel(item.label); }}><Pencil className="size-3.5" /></Button></div>}<div className="mt-0.5 text-xs text-muted-foreground">{item.number}</div><div className="mt-1 text-[10px] text-muted-foreground">Meta phone ID: {item.metaPhoneNumberId || "not configured"} · WABA: {item.metaWabaId || "not configured"} · Priority {index + 1}</div><div className={`mt-1 text-[10px] ${item.metaConnectionStatus === "CONNECTED" || item.metaConnectionStatus === "SERVER_TOKEN" ? "text-emerald-800" : item.metaConnectionStatus === "EXPIRING" ? "text-amber-800" : "text-red-700"}`}>Meta authorization: {item.metaConnectionStatus === "CONNECTED" ? "Connected" : item.metaConnectionStatus === "SERVER_TOKEN" ? "Using server access token · expiry not tracked here" : item.metaConnectionStatus === "EXPIRING" ? "Expires soon" : item.metaConnectionStatus === "EXPIRED" ? "Expired · reconnect required" : item.metaConnectionStatus === "INACTIVE" ? "Inactive · reconnect required" : item.metaConnectionStatus === "CONNECTION_MISSING" ? "Connection record missing" : "Not connected"}{item.metaTokenExpiresAt && <span className="text-muted-foreground"> · expires {new Date(item.metaTokenExpiresAt).toLocaleString()}</span>}</div>{item.displayName && <div className="mt-1 text-[10px] text-muted-foreground">Meta display name: {item.displayName}</div>}<div className="mt-1 text-[10px] text-muted-foreground">Last Meta status event: {item.lastStatusEventAt ? new Date(item.lastStatusEventAt).toLocaleString() : "Not received yet"}</div>{item.qualitySignal && <div className="mt-1 text-[10px] text-amber-800">Meta signal: {item.qualitySignal}</div>}</div><Badge variant={item.state === "Active" ? "success" : item.state === "Paused" ? "outline" : "warning"} className="gap-1.5">{item.state === "Active" ? <Wifi className="size-3" /> : item.state === "Paused" ? <Pause className="size-3" /> : <CircleAlert className="size-3" />}{item.state}</Badge>{item.state === "Restricted" && <p role="status" className="basis-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">Meta reported an account restriction. This number is excluded from sending and failover. Reconnecting access or passing a phone-number check does not clear the restriction; resolve it with Meta, then have an administrator review the account status.</p>}<div className="flex flex-wrap gap-2"><Button aria-label={`Move ${item.label} up`} title="Move up in priority" variant="outline" size="icon" disabled={index === 0 || item.state === "Archived"} onClick={() => updateNumber(item, "move_up")}><ArrowUp className="size-4" /></Button><Button aria-label={`Move ${item.label} down`} title="Move down in priority" variant="outline" size="icon" disabled={index === numbers.length - 1 || item.state === "Archived"} onClick={() => updateNumber(item, "move_down")}><ArrowDown className="size-4" /></Button>{item.state === "Pending approval" && <Button size="sm" onClick={() => updateNumber(item, "approve")}> <Check data-icon="inline-start" />Approve</Button>}{(item.state === "Paused" || item.state === "Disconnected") && <Button variant="outline" size="sm" onClick={() => updateNumber(item, "activate")}>{item.state === "Disconnected" ? "Reconnected" : "Activate"}</Button>}{item.state === "Active" && <Button variant="outline" size="sm" onClick={() => setConfirmLifecycle({ id: item.id, action: "pause" })}>Pause</Button>}{item.state !== "Archived" && <Button variant="ghost" size="sm" onClick={() => setConfirmLifecycle({ id: item.id, action: "archive" })}><Archive data-icon="inline-start" />Archive</Button>}</div>{confirmLifecycle?.id === item.id && <div role="alertdialog" aria-label={`${confirmLifecycle.action === "pause" ? "Pause" : "Archive"} sender number`} className="basis-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950"><p className="font-medium">{confirmLifecycle.action === "pause" ? "Pause this sender number?" : "Archive this sender number?"}</p><p className="mt-1">It will stop being available for new replies and automatic failover. Existing customer history stays in the CRM. You can reactivate a paused number later; an archived number remains out of routing.</p><div className="mt-2 flex justify-end gap-2"><Button size="sm" variant="outline" onClick={() => setConfirmLifecycle(null)}>Keep number active</Button><Button size="sm" variant="destructive" onClick={() => void updateNumber(item, confirmLifecycle.action)}>{confirmLifecycle.action === "pause" ? "Confirm pause" : "Confirm archive"}</Button></div></div>}</div>)}</div>
      </section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-sm font-semibold">Sender number team access</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Choose which teams may send from each number. Leaving every team unselected keeps the number available to all workspace teams. Server-side message checks enforce this selection.</p></div>{teams.length === 0 ? <p className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Create workspace teams first. Team-based access requires PostgreSQL.</p> : <div className="flex flex-col divide-y">{numbers.filter((item) => item.state !== "Archived").map((item) => { const selected = teamAccessDraft[item.id] ?? item.allowedTeamIds ?? []; return <div key={item.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-40 flex-1"><p className="text-xs font-medium">{item.label}</p><p className="text-[10px] text-muted-foreground">{selected.length ? `${selected.length} team${selected.length === 1 ? "" : "s"} selected` : "Available to all teams"}</p></div><div className="flex flex-wrap gap-1.5">{teams.map((team) => <Button key={team.id} type="button" size="sm" variant={selected.includes(team.id) ? "secondary" : "outline"} aria-pressed={selected.includes(team.id)} className="h-7 px-2 text-[10px]" onClick={() => setTeamAccessDraft((current) => ({ ...current, [item.id]: selected.includes(team.id) ? selected.filter((id) => id !== team.id) : [...selected, team.id] }))}>{team.name}</Button>)}</div><Button type="button" size="sm" variant="outline" disabled={JSON.stringify(selected) === JSON.stringify(item.allowedTeamIds ?? [])} onClick={() => void updateNumber(item, "set_allowed_teams", undefined, selected)}>Save access</Button></div>; })}</div>}</section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-4"><div><h2 className="text-sm font-semibold">Guarded sender failover</h2><p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">When enabled, the CRM may retry a message once on the next active number in the same WABA only after Meta returns the explicit phone-number-not-registered error. Account restrictions, quality warnings, recipient/template errors, and unknown send outcomes never trigger a switch.</p></div><Button type="button" variant={autoFailoverEnabled ? "default" : "outline"} disabled={failoverBusy || !liveSendingEnabled} onClick={() => void updateFailoverSetting(!autoFailoverEnabled)}>{failoverBusy ? "Saving…" : autoFailoverEnabled ? "Failover enabled" : "Failover disabled"}</Button></div><div className="mt-4 flex flex-wrap items-center gap-2"><span className="mr-2 text-xs font-medium">Retry cap:</span><Button type="button" size="sm" variant={failoverMaxAttempts === 1 ? "secondary" : "outline"} disabled={failoverBusy || !liveSendingEnabled} onClick={() => void updateFailoverSetting(autoFailoverEnabled, failoverMaxAttempts === 1 ? 0 : 1, failoverMaxAttempts === 1 ? false : failoverRequiresApproval)}>{failoverMaxAttempts === 1 ? "One backup attempt" : "No backup attempt"}</Button><span className="ml-3 mr-2 text-xs font-medium">Approval:</span><Button type="button" size="sm" variant={failoverRequiresApproval ? "secondary" : "outline"} disabled={failoverBusy || !liveSendingEnabled || failoverMaxAttempts === 0} onClick={() => void updateFailoverSetting(autoFailoverEnabled, failoverMaxAttempts, !failoverRequiresApproval)}>{failoverRequiresApproval ? "Admin approval required" : "Send automatically"}</Button></div><div className="mt-3 flex flex-wrap items-center gap-2"><span className="mr-2 text-xs font-medium">Backup cooldown:</span>{[0, 5, 15, 30, 60, 120].map((minutes) => <Button key={minutes} type="button" size="sm" variant={failoverCooldownMinutes === minutes ? "secondary" : "outline"} disabled={failoverBusy || !liveSendingEnabled} aria-pressed={failoverCooldownMinutes === minutes} onClick={() => void updateFailoverSetting(autoFailoverEnabled, failoverMaxAttempts, failoverRequiresApproval, minutes)}>{minutes ? `${minutes} min` : "Off"}</Button>)}</div><p className="mt-1 text-[11px] text-muted-foreground">Cooldown prevents retrying a backup for the same customer after a failed, uncertain, or declined backup attempt.</p>{failoverRequiresApproval && <p className="mt-2 text-[11px] text-muted-foreground">Eligible failures pause in Admin → Webhook health. An administrator must approve each backup send; the original message remains failed until the approved retry succeeds.</p>}<div className="mt-4 max-w-xl"><label className="flex flex-col gap-1.5 text-xs font-medium">Customer number-change notice <span className="font-normal text-muted-foreground">Optional. After a successful retry, send a recently synced approved Utility template with one body variable ({"{{1}}"}). The CRM fills it with the new number.</span><SelectControl aria-label="Customer number-change notice template" value={notificationTemplateId} disabled={failoverBusy || !liveSendingEnabled} onChange={(event) => void updateTransitionTemplate(event.target.value)} className="h-9 rounded-lg border bg-white px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"><option value="">Off · no automatic notice</option>{eligibleNoticeTemplates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.language}</option>)}</SelectControl></label>{notificationTemplateId && !eligibleNoticeTemplates.some((template) => template.id === notificationTemplateId) && <p className="mt-1 text-[11px] text-amber-800">The saved template is no longer eligible. Sync its current approval status or choose another template.</p>}<p className="mt-2 text-[11px] text-muted-foreground">Failover and customer notice are off by default. Notice sending requires recorded WhatsApp opt-in; all attempts appear in the shared history.</p></div>{!liveSendingEnabled && <p className="mt-3 text-[11px] text-muted-foreground">Connect PostgreSQL and Meta Cloud API credentials before enabling failover.</p>}</section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><div className="flex size-8 items-center justify-center rounded-lg bg-[#eef4ef] text-primary"><ShieldCheck className="size-4" /></div><div><h2 className="text-sm font-semibold">Connect a WhatsApp business account</h2><p className="text-xs text-muted-foreground">Use Meta’s official Embedded Signup to verify business access and load its phone numbers.</p></div></div><Button type="button" disabled={!metaSdkReady || !metaConfig.configured || metaConfig.needsMfa || metaConnecting} onClick={startMetaSignup}>{metaConnecting ? "Connecting…" : metaSdkReady ? "Connect with Meta" : "Meta setup required"}</Button></div>{metaConfig.needsMfa && <p className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">{metaConfig.mfaMessage ?? "Set up MFA and sign in with your authenticator before connecting Meta numbers."}</p>}{!metaConfig.configured && <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-950">Set <code>META_APP_ID</code>, <code>META_APP_SECRET</code>, <code>META_EMBEDDED_SIGNUP_CONFIG_ID</code>, PostgreSQL, and <code>SESSION_SECRET</code> to enable Meta signup. Meta App Review and the required business permissions are also needed for production.</p>}<Separator className="my-4" /><div className="mb-4 flex items-center gap-2"><div className="flex size-8 items-center justify-center rounded-lg bg-[#eef4ef] text-primary"><Plus className="size-4" /></div><div><h3 className="text-sm font-semibold">Manual mapping</h3><p className="text-xs text-muted-foreground">Use only for already-onboarded numbers when your workspace system-user token can access the WABA.</p></div></div>
        <form onSubmit={addNumber} className="grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-medium">Display label<Input required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. West region support" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Phone number in international format<Input required type="tel" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="+14155550123" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Meta phone number ID <span className="font-normal text-muted-foreground">Required for an already-onboarded number</span><Input required value={metaPhoneNumberId} onChange={(event) => setMetaPhoneNumberId(event.target.value)} placeholder="Optional until Meta onboarding" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">WhatsApp Business Account ID <span className="font-normal text-muted-foreground">Required for an already-onboarded number</span><Input required value={metaWabaId} onChange={(event) => setMetaWabaId(event.target.value)} placeholder="Optional until Meta onboarding" /></label><Button type="submit" disabled={busy} className="self-end"><Plus data-icon="inline-start" />{busy ? "Adding…" : "Add number"}</Button></form>
      </section>
      <section className="mt-5 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950"><div className="flex gap-3"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><div><div className="font-medium">Meta connection requirements</div><p className="mt-1 text-xs leading-relaxed text-sky-900">PostgreSQL approval and reactivation require a read-only Meta check that confirms the phone-number ID belongs to the connected WABA and matches this CRM number. It does not test message delivery or webhook health. Complete official Cloud API onboarding and configure the server’s Meta access token and app secret before connecting production numbers.</p></div></div></section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-3"><h2 className="text-sm font-semibold">Meta number checks</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Read-only check that the saved phone number ID is visible in its WABA and matches the CRM phone number. It does not send a WhatsApp message or change CRM number status.</p></div><div className="divide-y">{numbers.filter((item) => item.metaPhoneNumberId && item.metaWabaId).map((item) => { const check = connectionChecks[item.id]; return <div key={item.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-40 flex-1"><p className="text-xs font-medium">{item.label} · {item.number}</p>{check && !check.busy && <p role="status" className={`mt-1 text-[10px] ${check.outcome === "PASSED" ? "text-emerald-800" : "text-amber-800"}`}>{check.outcome === "PASSED" ? `Asset found${check.verifiedName ? ` · ${check.verifiedName}` : ""}${check.displayNumber ? ` · Meta ${check.displayNumber}` : ""}${check.numberMatches === null ? " · CRM number could not be compared" : ""}${check.qualityRating ? ` · Quality ${check.qualityRating}` : ""}` : check.error}{check.checkedAt ? ` · ${new Date(check.checkedAt).toLocaleString()}` : ""}</p>}{check?.busy && <p role="status" className="mt-1 text-[10px] text-muted-foreground">Checking Meta access…</p>}</div><Button type="button" variant="outline" size="sm" disabled={Boolean(check?.busy) || !liveSendingEnabled} onClick={() => void checkMetaNumber(item)}><RefreshCw className={`mr-1 size-3.5 ${check?.busy ? "animate-spin" : ""}`} />{check?.busy ? "Checking…" : "Check Meta"}</Button></div>; })}{!numbers.some((item) => item.metaPhoneNumberId && item.metaWabaId) && <p className="py-3 text-xs text-muted-foreground">Add a Meta phone number ID and WABA ID to enable a read-only check.</p>}</div></section>
    </div>
  </main>;
}
