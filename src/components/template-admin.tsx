"use client";

import { SelectControl } from "@/components/ui/select-control";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

type Template = { id: string; wabaId: string; metaTemplateId?: string; name: string; language: string; category: string; status: string; statusReason?: string | null; statusUpdatedAt?: string | null; qualityScore?: string | null; previousQualityScore?: string | null; qualityUpdatedAt?: string | null; components: { type?: string; text?: string }[]; syncedAt: string };
type Waba = { id: string; label: string };

export function TemplateAdmin({ initialTemplates, wabas, metaConfigured }: { initialTemplates: Template[]; wabas: Waba[]; metaConfigured: boolean }) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [selectedWaba, setSelectedWaba] = useState(wabas[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const response = await fetch("/api/templates", { cache: "no-store" });
        const data = await response.json();
        if (!disposed && response.ok && Array.isArray(data.templates)) setTemplates(data.templates);
      } catch { /* Keep the last known template state visible if the API is briefly unavailable. */ }
      finally { if (!disposed) timer = window.setTimeout(() => void refresh(), 30_000); }
    };
    timer = window.setTimeout(() => void refresh(), 30_000);
    return () => { disposed = true; if (timer) window.clearTimeout(timer); };
  }, []);

  async function syncTemplates() {
    if (!selectedWaba) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ wabaId: selectedWaba }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not sync templates from Meta.");
      const list = await fetch("/api/templates", { cache: "no-store" });
      const listData = await list.json();
      if (!list.ok) throw new Error(listData.error || "Templates synced but could not be loaded.");
      setTemplates(listData.templates);
      setNotice(`Synced ${data.synced} template${data.synced === 1 ? "" : "s"} from Meta.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sync templates."); }
    finally { setBusy(false); }
  }

  return <main className="min-h-screen bg-[#f7f8f6]">
    <header className="flex h-16 items-center justify-between border-b bg-white px-5 md:px-10"><div className="text-sm font-semibold">Relay CRM <span className="font-normal text-muted-foreground">/ Admin / Templates</span></div><nav className="flex items-center gap-4"><Link href="/admin/numbers" className="text-sm text-muted-foreground hover:text-foreground">Numbers</Link><Link href="/admin/team" className="text-sm text-muted-foreground hover:text-foreground">Team</Link><Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Inbox</Link></nav></header>
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <Link href="/admin/numbers" className="mb-5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" />Back to channels</Link>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold tracking-tight">WhatsApp templates</h1><p className="mt-1 text-sm text-muted-foreground">Sync approved templates from your connected WABA before sending.</p></div><Badge variant={metaConfigured ? "success" : "warning"}>{metaConfigured ? "Cloud API configured" : "Meta credentials required"}</Badge></div>
      {(error || notice) && <div role={error ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${error ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{error || notice}</div>}
      <section className="rounded-2xl border bg-white shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-3 p-5"><div><h2 className="text-sm font-semibold">Sync from Meta</h2><p className="mt-1 text-xs text-muted-foreground">Only WABAs already associated with a CRM number are available.</p></div><div className="flex gap-2"><SelectControl aria-label="Choose WhatsApp Business Account" value={selectedWaba} onChange={(event) => setSelectedWaba(event.target.value)} className="h-9 min-w-56 rounded-lg border bg-white px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={!wabas.length}><option value="">Choose WABA</option>{wabas.map((waba) => <option key={waba.id} value={waba.id}>{waba.label} · {waba.id}</option>)}</SelectControl><Button size="sm" onClick={() => void syncTemplates()} disabled={busy || !selectedWaba || !metaConfigured}><RefreshCw data-icon="inline-start" className={busy ? "animate-spin" : ""} />{busy ? "Syncing…" : "Sync templates"}</Button></div></div>
        <Separator />
        {templates.length ? <div className="divide-y">{templates.map((template) => {
          const body = template.components?.find((component) => component.type?.toUpperCase() === "BODY")?.text;
          const score = template.qualityScore?.toUpperCase();
          const qualityVariant = score === "GREEN" ? "success" : score === "YELLOW" || score === "RED" ? "warning" : "outline";
          return <div key={template.id} className="flex flex-wrap items-start gap-3 px-5 py-4"><div className="min-w-[220px] flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{template.name}</h3><Badge variant={template.status === "APPROVED" ? "success" : ["PAUSED", "DISABLED", "REJECTED", "FLAGGED"].includes(template.status) ? "warning" : "outline"}>{template.status}</Badge>{score && <Badge variant={qualityVariant} className={score === "RED" ? "border-red-200 bg-red-100 text-red-800" : undefined}>Quality {score}</Badge>}</div><p className="mt-1 text-[11px] text-muted-foreground">{template.category} · {template.language} · WABA {template.wabaId}</p>{body ? <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">{body}</p> : <p className="mt-2 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-muted-foreground">Template details are not synced yet. Sync from Meta to load components before sending.</p>}{template.statusReason && <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-950">Meta status reason: {template.statusReason}</p>}<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">{template.statusUpdatedAt && <span>Status updated {new Date(template.statusUpdatedAt).toLocaleString()}</span>}{template.qualityUpdatedAt && <span>Quality {template.previousQualityScore ? `${template.previousQualityScore} → ` : ""}{score} · {new Date(template.qualityUpdatedAt).toLocaleString()}</span>}<span>Last synced {new Date(template.syncedAt).toLocaleString()}</span></div></div></div>;
        })}</div> : <div className="px-5 py-12 text-center"><p className="text-sm font-medium">No templates synced</p><p className="mt-1 text-xs text-muted-foreground">Add a Meta phone number ID and WABA ID in Channels, then sync.</p></div>}
      </section>
      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">Template status and quality refresh automatically within about 30 seconds when the matching WhatsApp webhook fields are subscribed in Meta. Sync remains available for reconciliation. This first template sender supports approved templates with positional text variables in the body only. Header variables, buttons, media templates, and automatic customer notifications are not sent by this screen.</p>
    </div>
  </main>;
}
