"use client";

import { SelectControl } from "@/components/ui/select-control";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type AuditEvent = { id: string; action: string; targetType: string; targetId: string | null; sourceIp: string | null; userAgent: string | null; before: unknown; after: unknown; details: unknown; createdAt: string; actorName: string | null; actorEmail: string | null };
const targetTypes = ["ALL", "WORKSPACE", "USER", "CHANNEL_NUMBER", "CONTACT", "CONVERSATION", "TEAM", "ROUTING_RULE", "WHATSAPP_TEMPLATE", "CANNED_REPLY", "FAILOVER_EVENT"];

function safeJson(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const scrub = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(scrub);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, /password|secret|token|credential|rawpayload|messagebody|textbody/i.test(key) ? "[hidden]" : scrub(nested)]));
  };
  return JSON.stringify(scrub(value), null, 2);
}

async function fetchAuditPage(query: string, targetType: string, offset: number) {
  const params = new URLSearchParams({ limit: "50", offset: String(offset), q: query, targetType });
  const response = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load audit history.");
  return { events: (data.events ?? []) as AuditEvent[], total: Number(data.total ?? 0) };
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [targetType, setTargetType] = useState("ALL");
  const [loadedFilter, setLoadedFilter] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadCount, setReloadCount] = useState(0);
  const filterKey = `${targetType}\n${query}\n${reloadCount}`;
  const busy = loadingMore || loadedFilter !== filterKey;

  // Responses for an older search are ignored so fast typing cannot show results for a previous query.
  useEffect(() => {
    let active = true;
    fetchAuditPage(query, targetType, 0)
      .then((data) => { if (active) { setEvents(data.events); setTotal(data.total); setError(""); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load audit history."); })
      .finally(() => { if (active) setLoadedFilter(filterKey); });
    return () => { active = false; };
  }, [query, targetType, filterKey]);

  async function loadMore() {
    setLoadingMore(true); setError("");
    try {
      const data = await fetchAuditPage(query, targetType, events.length);
      setEvents((current) => [...current, ...data.events]);
      setTotal(data.total);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load audit history."); }
    finally { setLoadingMore(false); }
  }
  const summarize = (event: AuditEvent) => {
    const before = safeJson(event.before); const after = safeJson(event.after); const details = safeJson(event.details);
    return { before, after, details };
  };

  return <div className="space-y-4">
    <section className="flex flex-col gap-3 rounded-xl border bg-white p-4 sm:flex-row"><label className="relative flex-1"><span className="sr-only">Search audit history</span><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, target, actor, or IP" className="pl-9" /></label><label className="flex items-center gap-2 text-xs font-medium"><span className="sr-only">Filter by target type</span><SelectControl value={targetType} onChange={(event) => setTargetType(event.target.value)} className="h-10 rounded-md border bg-white px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring">{targetTypes.map((type) => <option key={type} value={type}>{type === "ALL" ? "All targets" : type.replaceAll("_", " ")}</option>)}</SelectControl></label><Button variant="outline" onClick={() => setReloadCount((count) => count + 1)} disabled={busy}>Refresh</Button></section>
    {error && <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">{error}</div>}
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>{total.toLocaleString()} audit events</span><span>Newest first</span></div>
    <div className="overflow-hidden rounded-xl border bg-white">{events.map((event) => { const values = summarize(event); return <article key={event.id} className="border-b p-4 last:border-0"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{event.action.replaceAll("_", " ").toLowerCase()}</h2><Badge variant="outline">{event.targetType.replaceAll("_", " ")}</Badge></div><p className="mt-1 break-all text-xs text-muted-foreground">{event.targetId || "No target ID"}</p></div><time className="shrink-0 text-[11px] text-muted-foreground" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time></div><div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-muted-foreground"><span>By {event.actorName || event.actorEmail || "System"}{event.actorEmail && event.actorName ? ` · ${event.actorEmail}` : ""}</span>{event.sourceIp && <span>IP {event.sourceIp}</span>}{event.userAgent && <span className="max-w-full truncate" title={event.userAgent}>{event.userAgent}</span>}</div>{(values.before || values.after || values.details) && <details className="mt-3"><summary className="cursor-pointer text-[11px] font-medium text-primary">View recorded change details</summary><div className="mt-2 grid gap-2 md:grid-cols-2">{values.before && <div><p className="mb-1 text-[10px] font-medium text-muted-foreground">Before</p><pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 text-[10px] leading-relaxed">{values.before}</pre></div>}{values.after && <div><p className="mb-1 text-[10px] font-medium text-muted-foreground">After</p><pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 text-[10px] leading-relaxed">{values.after}</pre></div>}{values.details && !values.before && !values.after && <div className="md:col-span-2"><pre className="max-h-48 overflow-auto rounded-lg bg-muted/50 p-3 text-[10px] leading-relaxed">{values.details}</pre></div>}</div></details>}</article>; })}{!events.length && !busy && !error && <p className="p-10 text-center text-sm text-muted-foreground">No matching audit events.</p>}{busy && !events.length && <p className="p-10 text-center text-sm text-muted-foreground">Loading audit history…</p>}</div>
    {events.length < total && <div className="flex justify-center"><Button variant="outline" onClick={() => void loadMore()} disabled={busy}>Load more</Button></div>}
  </div>;
}
