"use client";

import { CheckboxControl } from "@/components/ui/checkbox-control";

import { SelectControl } from "@/components/ui/select-control";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type NumberItem = { id: string; label: string; number: string; state: string; priority: number; metaWabaId: string | null; allowedTeamIds: string[] };
type Rule = { id: string; name: string; prefix: string; teamId: string | null; segmentId: string | null; numberIds: string[]; enabled: boolean };
type RoutingSettings = { rules: Rule[]; segments: { id: string; name: string }[]; numbers: NumberItem[] };

async function fetchRoutingSettings(): Promise<RoutingSettings> {
  const [ruleResponse, numberResponse] = await Promise.all([fetch("/api/routing", { cache: "no-store" }), fetch("/api/numbers", { cache: "no-store" })]);
  const ruleData = await ruleResponse.json(); const numberData = await numberResponse.json();
  if (!ruleResponse.ok || !numberResponse.ok) throw new Error(ruleData.error || numberData.error || "Could not refresh routing settings.");
  return { rules: ruleData.rules, segments: ruleData.segments ?? [], numbers: numberData.numbers };
}

export function RoutingAdmin({ initialNumbers, initialTeams, setupError }: { initialNumbers: NumberItem[]; initialTeams: { id: string; name: string }[]; setupError: string }) {
  const [numbers, setNumbers] = useState(initialNumbers);
  const [rules, setRules] = useState<Rule[]>([]);
  const [segments, setSegments] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState("");
  const [prefix, setPrefix] = useState("");
  const [teamId, setTeamId] = useState("");
  const [segmentId, setSegmentId] = useState("");
  const [numberIds, setNumberIds] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(setupError);
  const [notice, setNotice] = useState("");
  const activeNumbers = numbers.filter((number) => number.state === "ACTIVE");
  const applySettings = useCallback((data: RoutingSettings) => { setRules(data.rules); setSegments(data.segments); setNumbers(data.numbers); }, []);
  const refresh = useCallback(async () => applySettings(await fetchRoutingSettings()), [applySettings]);
  useEffect(() => {
    if (setupError) return;
    let active = true;
    fetchRoutingSettings().then((data) => { if (active) applySettings(data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load routing settings."); });
    return () => { active = false; };
  }, [applySettings, setupError]);

  async function createRule(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/routing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, prefix, teamId: teamId || null, segmentId: segmentId || null, numberIds, enabled }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save rule.");
      setName(""); setPrefix(""); setTeamId(""); setSegmentId(""); setNumberIds([]); setNotice("Routing rule saved and audited."); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save rule."); }
    finally { setBusy(false); }
  }
  async function toggle(rule: Rule) {
    setBusy(true); setError("");
    try { const response = await fetch("/api/routing", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rule.id, enabled: !rule.enabled }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update rule."); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update rule."); } finally { setBusy(false); }
  }
  async function remove(rule: Rule) {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/routing?id=${encodeURIComponent(rule.id)}`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not remove rule."); await refresh(); setNotice("Routing rule removed and audited."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not remove rule."); } finally { setBusy(false); }
  }
  async function reorder(number: NumberItem, direction: "up" | "down") {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/numbers/${number.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: direction === "up" ? "move_up" : "move_down" }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not reorder numbers."); setNumbers(data.numbers); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reorder numbers."); } finally { setBusy(false); }
  }

  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}{notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
    <section className="rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="text-sm font-semibold">New routing rule</h2><p className="mt-1 text-xs text-muted-foreground">Rules can match a saved customer segment, team, and country prefix, then try the configured sender numbers in order.</p></div><Separator /><form onSubmit={createRule} className="grid gap-4 p-5 md:grid-cols-2"><label className="space-y-1.5 text-xs font-medium">Rule name<Input required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="India support" /></label><label className="space-y-1.5 text-xs font-medium">Customer phone country prefix<Input maxLength={6} inputMode="numeric" value={prefix} onChange={(event) => setPrefix(event.target.value.replace(/\D/g, ""))} placeholder="91 · leave empty for any" /><span className="block font-normal text-muted-foreground">Digits only, without +. Empty prefix matches every customer.</span></label><label className="space-y-1.5 text-xs font-medium">Assigned team<SelectControl value={teamId} onChange={(event) => setTeamId(event.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm"><option value="">Any team</option>{initialTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</SelectControl><span className="block font-normal text-muted-foreground">Uses the customer’s latest conversation team assignment.</span></label><label className="space-y-1.5 text-xs font-medium">Customer segment<SelectControl value={segmentId} onChange={(event) => setSegmentId(event.target.value)} className="h-9 w-full rounded-md border bg-white px-3 text-sm"><option value="">Any segment</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</SelectControl><span className="block font-normal text-muted-foreground">Segment membership is checked when routing each message.</span></label><fieldset className="space-y-2 md:col-span-2"><legend className="text-xs font-medium">Approved active numbers, in send priority order</legend><div className="grid gap-2 sm:grid-cols-2">{activeNumbers.map((number) => <label key={number.id} className="flex items-center gap-2 rounded-lg border p-3 text-xs"><CheckboxControl aria-label={`Use ${number.label} for this routing rule`} checked={numberIds.includes(number.id)} onChange={(event) => setNumberIds((current) => event.target.checked ? [...current, number.id] : current.filter((id) => id !== number.id))} /><span className="min-w-0 flex-1"><span className="block font-medium">{number.label}</span><span className="text-muted-foreground">{number.number} · {number.metaWabaId ? `WABA ${number.metaWabaId}` : "WABA not set"}</span></span></label>)}{!activeNumbers.length && <p className="text-xs text-muted-foreground">Approve and activate a sender number first.</p>}</div></fieldset><label className="flex items-center gap-2 text-xs md:col-span-2"><CheckboxControl aria-label="Enable this routing rule immediately" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />Enable this rule immediately</label><div className="md:col-span-2"><Button type="submit" disabled={busy || Boolean(setupError)}><Plus data-icon="inline-start" />Save routing rule</Button></div></form></section>
    <section className="rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="text-sm font-semibold">Rule priority</h2><p className="mt-1 text-xs text-muted-foreground">Each rule tries only the listed approved, active numbers. WhatsApp restrictions, consent, templates, and service-window checks still apply.</p></div><Separator /><div className="divide-y">{rules.length ? rules.map((rule, index) => <div key={rule.id} className="flex flex-wrap items-center gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium">{index + 1}. {rule.name}</p><Badge variant={rule.enabled ? "success" : "outline"}>{rule.enabled ? "Enabled" : "Paused"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">Prefix {rule.prefix ? `+${rule.prefix}` : "any"} · Team {initialTeams.find((team) => team.id === rule.teamId)?.name ?? "any"} · Segment {segments.find((segment) => segment.id === rule.segmentId)?.name ?? "any"} · {rule.numberIds.map((id) => numbers.find((number) => number.id === id)?.label ?? "Unavailable number").join(" → ")}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => void toggle(rule)}>{rule.enabled ? "Pause" : "Enable"}</Button><Button variant="ghost" size="icon" aria-label={`Delete ${rule.name}`} disabled={busy} onClick={() => void remove(rule)}><Trash2 className="size-4" /></Button></div>) : <p className="p-5 text-xs text-muted-foreground">No routing rules saved. Workspace number priority will be used.</p>}</div></section>
    <section className="rounded-2xl border bg-white shadow-sm"><div className="p-5"><h2 className="text-sm font-semibold">Workspace fallback number order</h2><p className="mt-1 text-xs text-muted-foreground">Used when no country-prefix rule matches, or when creating a customer through the inbox. Only active and approved numbers can be selected.</p></div><Separator /><div className="divide-y">{numbers.map((number, index) => <div key={number.id} className="flex items-center gap-3 p-4"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{index + 1}. {number.label} · {number.number}</p><p className="mt-1 text-[10px] text-muted-foreground">{number.state} · current priority {number.priority}</p></div><Button variant="outline" size="icon" aria-label={`Move ${number.label} up`} disabled={busy || index === 0} onClick={() => void reorder(number, "up")}><ArrowUp className="size-4" /></Button><Button variant="outline" size="icon" aria-label={`Move ${number.label} down`} disabled={busy || index === numbers.length - 1} onClick={() => void reorder(number, "down")}><ArrowDown className="size-4" /></Button></div>)}</div></section>
  </div>;
}
