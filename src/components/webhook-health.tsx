"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Download, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type FailedEvent = { id: string; eventType: string; errorSummary: string | null; attemptCount: number; receivedAt: string; nextAttemptAt: string | null } | null;
type Incident = { kind: string; severity: string; category: string; summary: string; occurredAt: string };
type RetryClaims = { byStatus: Record<string, { count: number; staleProcessing: number }>; reviewItems: { status: string; createdAt: string | null; updatedAt: string | null }[] };
type PendingFailover = { id: string; triggeringMessageId: string; fromLabel: string; toLabel: string; reasonClass: string; messageType: string; messagePreview: string; providerErrorCode: number | null; routingRuleId: string | null; routingRuleVersion: number | null; approvalRequired: boolean; outcome: string; canResume: boolean; createdAt: string | null };
type Health = { activeNumbers: number; lastInboundAt: string | null; lastOutboundAt: string | null; queueDepth: number; failed24h: number; total24h: number; failureRate24h: number; webhookLagSeconds: number; recentFailovers: { id: string; fromLabel: string; toLabel: string; reasonClass: string; providerErrorCode: number | null; providerErrorSubcode: number | null; httpStatus: number | null; routingRuleId: string | null; routingRuleVersion: number | null; outcome: string; createdAt: string | null }[] };
type Snapshot = { counts: Record<string, number>; mediaCounts: Record<string, number>; latestFailed: FailedEvent; pendingFailovers: PendingFailover[]; health: Health | null; incidents: Incident[]; retryClaims: RetryClaims };

async function fetchSnapshot(): Promise<Snapshot> {
  const [response, diagnosticsResponse] = await Promise.all([fetch("/api/admin/webhooks", { cache: "no-store" }), fetch("/api/admin/diagnostics", { cache: "no-store" })]);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load webhook health.");
  const diagnostics = diagnosticsResponse.ok ? await diagnosticsResponse.json() : { incidents: [] };
  return { ...data, incidents: Array.isArray(diagnostics.incidents) ? diagnostics.incidents : [], retryClaims: diagnostics.retryClaims && typeof diagnostics.retryClaims === "object" ? diagnostics.retryClaims : { byStatus: {}, reviewItems: [] } };
}

export function WebhookHealth({ initialCounts, initialLatestFailed, setupError }: { initialCounts: Record<string, number>; initialLatestFailed: FailedEvent; setupError: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot>({ counts: initialCounts, mediaCounts: {}, latestFailed: initialLatestFailed, pendingFailovers: [], health: null, incidents: [], retryClaims: { byStatus: {}, reviewItems: [] } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(setupError);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => setSnapshot(await fetchSnapshot()), []);
  useEffect(() => {
    if (setupError) return;
    let active = true;
    fetchSnapshot().then((data) => { if (active) setSnapshot(data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load operations health."); });
    return () => { active = false; };
  }, [setupError]);

  async function recover() {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ limit: 50 }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Webhook recovery failed.");
      await refresh();
      setNotice(`Recovery checked ${data.claimed} event${data.claimed === 1 ? "" : "s"}: ${data.processed} processed, ${data.failed} still failing. ${data.retryClaimsMovedToReview ?? 0} stale outbound retr${data.retryClaimsMovedToReview === 1 ? "y" : "ies"} moved to review. Media archives: ${data.media?.archived ?? 0} saved, ${data.media?.quarantined ?? 0} quarantined, ${data.media?.failed ?? 0} failed.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Webhook recovery failed."); }
    finally { setBusy(false); }
  }

  async function retryFailedEvent() {
    if (!snapshot.latestFailed) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ retryEventId: snapshot.latestFailed.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not retry event.");
      await refresh();
      setNotice(`Manual retry finished: ${data.processed} processed, ${data.failed} still failing. Media archives: ${data.media?.archived ?? 0} saved, ${data.media?.quarantined ?? 0} quarantined, ${data.media?.failed ?? 0} failed.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not retry event."); }
    finally { setBusy(false); }
  }

  async function reviewFailover(id: string, action: "APPROVE" | "DECLINE" | "RESUME") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/webhooks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ failoverAction: action, failoverId: id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not process the backup-send request.");
      await refresh();
      setNotice(action === "DECLINE" ? "Backup send declined. The original message remains failed for an agent to handle." : data.outcome === "SENT" ? "Approved backup send was accepted by WhatsApp." : "Backup send is being checked; review its delivery status before trying again.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not process the backup-send request."); }
    finally { setBusy(false); }
  }

  const states = [
    ["RECEIVED", "Waiting"], ["PROCESSING", "Processing"], ["FAILED", "Failed"], ["PROCESSED", "Processed"],
  ] as const;
  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
    {snapshot.retryClaims.reviewItems.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50/50 p-5 shadow-sm"><div className="flex items-start gap-3"><Activity className="mt-0.5 size-4 text-amber-800" /><div><h2 className="text-sm font-semibold text-amber-950">Outbound retries need review</h2><p className="mt-1 text-xs leading-relaxed text-amber-900">These retries may have reached WhatsApp before the CRM recorded their final state. Reconcile the message status before creating another send.</p></div></div><div className="mt-3 divide-y divide-amber-200">{snapshot.retryClaims.reviewItems.map((item, index) => <div key={`${item.status}-${item.createdAt}-${index}`} className="flex flex-wrap items-center gap-3 py-2"><span className="flex-1 text-xs font-medium">Retry status: {item.status.replaceAll("_", " ")}</span><span className="text-[10px] text-amber-900">Updated {item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "time unavailable"}</span></div>)}</div></section>}
    {snapshot.health && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><Activity className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">Operations health</h2><p className="mt-1 text-xs text-muted-foreground">Live workspace status from persisted WhatsApp events and message records.</p></div></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[
      ["Active numbers", snapshot.health.activeNumbers, "Available for routing"],
      ["Webhook lag", snapshot.health.webhookLagSeconds ? `${snapshot.health.webhookLagSeconds}s` : "No backlog", "Oldest waiting or processing event"],
      ["Message queue", snapshot.health.queueDepth, "Queued, sending, or uncertain"],
      ["Failed in 24 hours", `${snapshot.health.failureRate24h}%`, `${snapshot.health.failed24h} of ${snapshot.health.total24h} messages`],
    ].map(([label, value, detail]) => <div key={String(label)} className="rounded-xl border bg-slate-50 p-4"><div className="text-xs text-muted-foreground">{label}</div><div className="mt-2 text-xl font-semibold tabular-nums">{value}</div><p className="mt-1 text-[10px] text-muted-foreground">{detail}</p></div>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last inbound</p><p className="mt-1 text-xs font-medium">{snapshot.health.lastInboundAt ? new Date(snapshot.health.lastInboundAt).toLocaleString() : "No inbound message recorded"}</p></div><div className="rounded-xl border p-3"><p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Last outbound</p><p className="mt-1 text-xs font-medium">{snapshot.health.lastOutboundAt ? new Date(snapshot.health.lastOutboundAt).toLocaleString() : "No outbound message recorded"}</p></div></div></section>}
    <section className="rounded-2xl border bg-white shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="text-sm font-semibold">Persisted webhook events</h2><p className="mt-1 text-xs text-muted-foreground">Recovery processes saved events and retries inbound media archives on the same schedule.</p></div><div className="flex gap-2"><Button asChild type="button" variant="outline" size="sm"><a href="/api/admin/diagnostics?download=1"><Download data-icon="inline-start" />Download diagnostics</a></Button><Button type="button" variant="outline" size="sm" onClick={() => void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed."))}>Refresh</Button><Button type="button" size="sm" disabled={busy || Boolean(setupError)} onClick={() => void recover()}><RefreshCw data-icon="inline-start" className={busy ? "animate-spin" : ""} />{busy ? "Recovering…" : "Recover pending"}</Button></div></div><Separator /><div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">{states.map(([key, label]) => <div key={key} className="rounded-xl border bg-slate-50 p-4"><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Badge variant={key === "FAILED" ? "warning" : key === "PROCESSED" ? "success" : "outline"}>{key}</Badge></div><div className="mt-3 text-2xl font-semibold tabular-nums">{snapshot.counts[key] ?? 0}</div></div>)}</div><Separator /><div className="flex flex-wrap gap-5 p-5 text-xs"><span><strong className="tabular-nums">{snapshot.mediaCounts.PENDING ?? 0}</strong> media waiting</span><span><strong className="tabular-nums">{snapshot.mediaCounts.PROCESSING ?? 0}</strong> media archiving</span><span><strong className="tabular-nums">{snapshot.mediaCounts.SCANNING ?? 0}</strong> media scanning</span><span><strong className="tabular-nums">{snapshot.mediaCounts.FAILED ?? 0}</strong> media failed</span><span><strong className="tabular-nums">{snapshot.mediaCounts.STORED ?? 0}</strong> media archived</span><span className="text-red-800"><strong className="tabular-nums">{snapshot.mediaCounts.QUARANTINED ?? 0}</strong> quarantined</span></div></section>
    {snapshot.latestFailed && <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><h2 className="text-sm font-semibold">Most recent failed event</h2><Badge variant="warning">{snapshot.latestFailed.eventType}</Badge></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void retryFailedEvent()}>{busy ? "Retrying…" : "Retry this event"}</Button></div><p className="text-xs leading-relaxed text-slate-700">{snapshot.latestFailed.errorSummary || "No error summary recorded."}</p><p className="mt-2 text-[11px] text-muted-foreground">Attempts: {snapshot.latestFailed.attemptCount} · Received {new Date(snapshot.latestFailed.receivedAt).toLocaleString()}{snapshot.latestFailed.nextAttemptAt ? ` · Next retry ${new Date(snapshot.latestFailed.nextAttemptAt).toLocaleString()}` : " · Retry limit reached or no retry scheduled"}</p></section>}
    {snapshot.pendingFailovers.length > 0 && <section className="rounded-2xl border border-amber-300 bg-amber-50/40 p-5 shadow-sm"><h2 className="text-sm font-semibold">Backup sends needing review</h2><p className="mt-1 text-xs text-muted-foreground">The original send was rejected by Meta. Approving creates one new send from the approved backup number; the original chat remains attached to its original number.</p><div className="mt-3 divide-y">{snapshot.pendingFailovers.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{item.fromLabel} → {item.toLabel}</p><p className="mt-1 line-clamp-2 text-xs text-slate-700">{item.messageType === "template" ? "Template: " : "Message: "}{item.messagePreview || "(empty message preview)"}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.reasonClass.replaceAll("_", " ")} · Meta code {item.providerErrorCode ?? "—"} · {item.routingRuleVersion != null ? `Routing rule v${item.routingRuleVersion}` : "Default number priority"} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable"}</p></div>{item.approvalRequired ? <><Button type="button" size="sm" disabled={busy} onClick={() => void reviewFailover(item.id, "APPROVE")}>Approve and send</Button><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reviewFailover(item.id, "DECLINE")}>Decline</Button></> : item.canResume ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void reviewFailover(item.id, "RESUME")}>Resume approved send</Button> : <Badge variant="outline">Approval recorded · processing</Badge>}</div>)}</div></section>}
    {snapshot.health && <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-sm font-semibold">Recent failovers</h2>{snapshot.health.recentFailovers.length ? <div className="mt-3 divide-y">{snapshot.health.recentFailovers.map((item) => <div key={item.id} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{item.fromLabel} → {item.toLabel}</p><p className="mt-1 text-[10px] text-muted-foreground">{item.reasonClass.replaceAll("_", " ")} · Meta code {item.providerErrorCode ?? "—"}{item.providerErrorSubcode != null ? `/${item.providerErrorSubcode}` : ""} · HTTP {item.httpStatus ?? "—"} · {item.routingRuleVersion != null ? `Routing rule v${item.routingRuleVersion}` : "Default number priority"} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : "Time unavailable"}</p></div><Badge variant={item.outcome === "SENT" ? "success" : item.outcome === "FAILED" || item.outcome === "NEEDS_REVIEW" ? "warning" : "outline"}>{item.outcome.replaceAll("_", " ")}</Badge></div>)}</div> : <p className="mt-3 text-xs text-muted-foreground">No failover events recorded.</p>}</section>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Activity className="size-4 text-primary" /><div><h2 className="text-sm font-semibold">Operational incident timeline</h2><p className="mt-1 text-xs text-muted-foreground">Alerts, delivery recovery issues, failovers, and administrative changes. Customer message content is excluded.</p></div></div>{snapshot.incidents.length ? <div className="mt-4 divide-y">{snapshot.incidents.map((incident, index) => <div key={`${incident.kind}-${incident.occurredAt}-${index}`} className="flex flex-wrap items-center gap-3 py-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{incident.summary}</p><p className="mt-1 text-[10px] text-muted-foreground">{incident.category.replaceAll("_", " ")} · {new Date(incident.occurredAt).toLocaleString()}</p></div><Badge variant={incident.severity === "CRITICAL" ? "warning" : incident.severity === "INFO" ? "secondary" : "outline"}>{incident.severity}</Badge></div>)}</div> : <p className="mt-4 text-xs text-muted-foreground">No operational incidents or admin actions are recorded yet.</p>}</section>
    <p className="text-xs leading-relaxed text-muted-foreground">Inbound Meta message IDs are deduplicated. Events that arrive before an outbound message is correlated are retried with bounded backoff; exhausted events remain stored for administrator review.</p>
  </div>;
}
