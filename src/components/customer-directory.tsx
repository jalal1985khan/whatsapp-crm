"use client";

import { SelectControl } from "@/components/ui/select-control";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDownToLine, ArrowUpRight, FileUp, Pencil, Plus, Search, ShieldAlert, ShieldOff, Trash2, UserRoundPlus, X } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ContactImport } from "@/components/contact-import";

type Contact = { id: string; name: string; initials: string; phone: string; additionalPhones?: string[]; email?: string; source?: string; ownerUserId?: string; ownerName?: string; tags?: string[]; customFields?: Record<string, unknown>; preview: string; time: string; label?: string; color: string; state?: string; messagingConsent?: "unknown" | "opted_in" | "opted_out"; legalHoldAt?: string | null; legalHoldReason?: string | null; messageCount?: number; messages?: unknown[] };
type Owner = { id: string; name: string; email: string; role: string };
type DuplicatePair = { firstId: string; firstName: string; firstPhone: string; secondId: string; secondName: string; secondPhone: string; reasons: string[] };
type SegmentFilters = { tag: string; source: string; ownerUserId: string; consent: "any" | "opted_in" | "opted_out" | "unknown" };
type CustomerSegment = { id: string; name: string; filters: SegmentFilters };
const emptySegmentFilters: SegmentFilters = { tag: "", source: "", ownerUserId: "", consent: "any" };

export function CustomerDirectory({ contacts, owners = [], canManagePrivacy = false, canEditProfiles = false, initialAdding = false }: { contacts: Contact[]; owners?: Owner[]; canManagePrivacy?: boolean; canEditProfiles?: boolean; initialAdding?: boolean }) {
  const [items, setItems] = useState(contacts);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(initialAdding);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", email: "", source: "", ownerUserId: "", tags: "", customFields: "{}" });
  const [duplicates, setDuplicates] = useState<DuplicatePair[]>([]);
  const [duplicateError, setDuplicateError] = useState("");
  const [mergeTargetByPair, setMergeTargetByPair] = useState<Record<string, string>>({});
  const [privacyError, setPrivacyError] = useState("");
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [segmentName, setSegmentName] = useState("");
  const [segmentFilters, setSegmentFilters] = useState<SegmentFilters>(emptySegmentFilters);
  const [segmentError, setSegmentError] = useState("");
  const selectedSegment = segments.find((segment) => segment.id === selectedSegmentId);
  const visible = useMemo(() => items.filter((contact) => {
    if (!`${contact.name} ${contact.phone} ${(contact.additionalPhones ?? []).join(" ")} ${contact.label ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    const filters = selectedSegment?.filters;
    if (!filters) return true;
    if (filters.tag && !(contact.tags ?? (contact.label ? [contact.label] : [])).some((tag) => tag.toLowerCase() === filters.tag.toLowerCase())) return false;
    if (filters.source && (contact.source ?? "").toLowerCase() !== filters.source.toLowerCase()) return false;
    if (filters.ownerUserId && contact.ownerUserId !== filters.ownerUserId) return false;
    if (filters.consent !== "any" && (contact.messagingConsent ?? "unknown") !== filters.consent) return false;
    return true;
  }), [items, query, selectedSegment]);

  useEffect(() => {
    if (!canManagePrivacy) return;
    void fetch("/api/contacts/duplicates", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not check duplicate records.");
      if (Array.isArray(data.duplicates)) setDuplicates(data.duplicates);
    }).catch((cause) => setDuplicateError(cause instanceof Error ? cause.message : "Could not check duplicate records."));
  }, [canManagePrivacy]);

  useEffect(() => {
    if (!canManagePrivacy) return;
    void fetch("/api/customer-segments", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load customer segments.");
      if (Array.isArray(data.segments)) setSegments(data.segments);
    }).catch((cause) => setSegmentError(cause instanceof Error ? cause.message : "Could not load customer segments."));
  }, [canManagePrivacy]);

  async function saveSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSegmentError("");
    try {
      const response = await fetch("/api/customer-segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: segmentName, filters: segmentFilters }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save this segment.");
      setSegments((current) => [...current, data.segment].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSegmentId(data.segment.id); setSegmentName(""); setSegmentFilters(emptySegmentFilters);
    } catch (cause) { setSegmentError(cause instanceof Error ? cause.message : "Could not save this segment."); }
  }

  async function deleteSegment() {
    if (!selectedSegment || !window.confirm(`Delete the saved segment “${selectedSegment.name}”? Customer records will not be deleted.`)) return;
    setSegmentError("");
    try {
      const response = await fetch(`/api/customer-segments?id=${encodeURIComponent(selectedSegment.id)}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not delete this segment.");
      setSegments((current) => current.filter((segment) => segment.id !== selectedSegment.id)); setSelectedSegmentId("");
    } catch (cause) { setSegmentError(cause instanceof Error ? cause.message : "Could not delete this segment."); }
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/contacts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, phone }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add customer.");
      setItems((current) => [data.contact, ...current]); setName(""); setPhone(""); setAdding(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add customer."); }
    finally { setBusy(false); }
  }

  function beginEdit(contact: Contact) {
    setEditingId(contact.id);
    setDraft({ name: contact.name, phone: contact.phone, email: contact.email ?? "", source: contact.source ?? "", ownerUserId: contact.ownerUserId ?? "", tags: (contact.tags ?? (contact.label ? [contact.label] : [])).join(", "), customFields: JSON.stringify(contact.customFields ?? {}, null, 2) });
    setError("");
  }

  async function saveContact(event: FormEvent<HTMLFormElement>, contact: Contact) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      let customFields: unknown;
      try { customFields = JSON.parse(draft.customFields); } catch { throw new Error("Custom fields must be valid JSON."); }
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: draft.name, phone: draft.phone, email: draft.email, source: draft.source, ownerUserId: draft.ownerUserId || null, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), customFields }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not update customer details.");
      setItems((current) => current.map((item) => item.id === contact.id ? { ...item, ...data.chat } : item)); setEditingId("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update customer details."); }
    finally { setBusy(false); }
  }

  async function mergePair(pair: DuplicatePair) {
    const pairKey = `${pair.firstId}:${pair.secondId}`;
    const targetId = mergeTargetByPair[pairKey] ?? pair.firstId;
    const sourceId = targetId === pair.firstId ? pair.secondId : pair.firstId;
    const targetName = targetId === pair.firstId ? pair.firstName : pair.secondName;
    const sourceName = sourceId === pair.firstId ? pair.firstName : pair.secondName;
    if (!window.confirm(`Merge ${sourceName} into ${targetName}? Messages, notes, consent history and phone identifiers will move to the retained record. The source contact ID will remain as a merge record.`)) return;
    setBusy(true); setDuplicateError("");
    try {
      const response = await fetch("/api/contacts/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sourceId, targetId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not merge customer records.");
      window.location.reload();
    } catch (cause) { setDuplicateError(cause instanceof Error ? cause.message : "Could not merge customer records."); }
    finally { setBusy(false); }
  }

  async function privacyAction(contact: Contact, action: "hold" | "release" | "delete") {
    setPrivacyError("");
    const reason = action === "hold" ? window.prompt("Reason for legal hold (recorded in the audit log):")?.trim() : undefined;
    if (action === "hold" && !reason) return;
    if (action === "release" && !window.confirm(`Release the legal hold for ${contact.name}?`)) return;
    if (action === "delete" && !window.confirm(`Permanently delete ${contact.name} and their CRM conversation history? This cannot be undone.`)) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/privacy`, action === "delete" ? { method: "DELETE" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update customer privacy settings.");
      if (action === "delete") setItems((current) => current.filter((item) => item.id !== contact.id));
      else setItems((current) => current.map((item) => item.id === contact.id ? { ...item, legalHoldAt: action === "hold" ? new Date().toISOString() : null, legalHoldReason: action === "hold" ? reason : null } : item));
    } catch (cause) { setPrivacyError(cause instanceof Error ? cause.message : "Could not update customer privacy settings."); }
    finally { setBusy(false); }
  }

  return <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b p-4"><div className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search customers" className="pl-9" /></div>{canManagePrivacy && <><SelectControl aria-label="Customer segment" value={selectedSegmentId} onChange={(event) => setSelectedSegmentId(event.target.value)} className="h-9 min-w-44 rounded-md border bg-white px-3 text-sm"><option value="">All customers</option>{segments.map((segment) => <option key={segment.id} value={segment.id}>{segment.name}</option>)}</SelectControl>{selectedSegment && <Button type="button" size="sm" variant="ghost" onClick={() => void deleteSegment()}>Delete segment</Button>}</>}</div><div className="flex items-center gap-3"><p className="text-xs text-muted-foreground">Showing {visible.length} of {items.length}</p>{canManagePrivacy && <Button type="button" size="sm" variant="outline" onClick={() => setImportOpen((value) => !value)}><FileUp data-icon="inline-start" />{importOpen ? "Close import" : "Import CSV"}</Button>}<Button size="sm" onClick={() => { setError(""); setAdding((value) => !value); }}>{adding ? <X data-icon="inline-start" /> : <UserRoundPlus data-icon="inline-start" />}{adding ? "Cancel" : "Add customer"}</Button></div></div>
    {canManagePrivacy && <form onSubmit={(event) => void saveSegment(event)} className="grid gap-2 border-b bg-muted/40 p-4 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]"><label className="flex flex-col gap-1 text-[11px] font-medium">New segment<Input required maxLength={40} value={segmentName} onChange={(event) => setSegmentName(event.target.value)} placeholder="Segment name" /></label><label className="flex flex-col gap-1 text-[11px] font-medium">Tag<Input maxLength={80} value={segmentFilters.tag} onChange={(event) => setSegmentFilters({ ...segmentFilters, tag: event.target.value })} placeholder="VIP" /></label><label className="flex flex-col gap-1 text-[11px] font-medium">Source<Input maxLength={200} value={segmentFilters.source} onChange={(event) => setSegmentFilters({ ...segmentFilters, source: event.target.value })} placeholder="Website" /></label><label className="flex flex-col gap-1 text-[11px] font-medium">Owner<SelectControl value={segmentFilters.ownerUserId} onChange={(event) => setSegmentFilters({ ...segmentFilters, ownerUserId: event.target.value })} className="h-9 rounded-md border bg-white px-3 text-sm"><option value="">Any owner</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</SelectControl></label><label className="flex flex-col gap-1 text-[11px] font-medium">WhatsApp consent<SelectControl value={segmentFilters.consent} onChange={(event) => setSegmentFilters({ ...segmentFilters, consent: event.target.value as SegmentFilters["consent"] })} className="h-9 rounded-md border bg-white px-3 text-sm"><option value="any">Any consent</option><option value="opted_in">Opted in</option><option value="opted_out">Opted out</option><option value="unknown">Not recorded</option></SelectControl></label><Button type="submit" className="self-end">Save segment</Button>{segmentError && <p role="alert" className="text-xs text-red-700 md:col-span-6">{segmentError}</p>}</form>}
    {privacyError && <p role="alert" className="border-b bg-red-50 px-4 py-2 text-xs text-red-800">{privacyError}</p>}
    {importOpen && canManagePrivacy && <div className="border-b p-4"><ContactImport onImported={() => window.location.reload()} /></div>}
    {canManagePrivacy && <div className="border-b bg-muted/40 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-sm font-semibold">Possible duplicates</h2><p className="mt-1 text-xs text-muted-foreground">Review matching names, emails, or phone history. Pick which record to keep.</p></div><Badge variant="secondary">{duplicates.length} pairs</Badge></div>{duplicateError && <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">{duplicateError}</p>}{duplicates.length > 0 && <div className="mt-3 divide-y rounded-lg border bg-white">{duplicates.map((pair) => { const key = `${pair.firstId}:${pair.secondId}`; const targetId = mergeTargetByPair[key] ?? pair.firstId; return <div key={key} className="flex flex-wrap items-center gap-3 p-3"><div className="min-w-0 flex-1"><p className="text-xs font-medium">{pair.firstName} · {pair.firstPhone} <span className="text-muted-foreground">and</span> {pair.secondName} · {pair.secondPhone}</p><p className="mt-1 text-[10px] text-muted-foreground">Matched by {pair.reasons.join(", ")}</p></div><label className="flex items-center gap-2 text-[11px] text-muted-foreground">Keep<SelectControl value={targetId} onChange={(event) => setMergeTargetByPair((current) => ({ ...current, [key]: event.target.value }))} className="h-8 max-w-[180px] rounded-md border bg-white px-2 text-xs text-foreground"><option value={pair.firstId}>{pair.firstName} · {pair.firstPhone}</option><option value={pair.secondId}>{pair.secondName} · {pair.secondPhone}</option></SelectControl></label><Button size="sm" variant="outline" disabled={busy} onClick={() => void mergePair(pair)}>Review and merge</Button></div>; })}</div>}</div>}
    {adding && <form onSubmit={addContact} className="grid gap-3 border-b bg-muted/40 p-4 md:grid-cols-[1fr_1fr_auto]"><label className="flex flex-col gap-1.5 text-xs font-medium">Customer name<Input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Full name" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">WhatsApp phone number<Input required value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+14155550123" /></label><Button type="submit" disabled={busy} className="self-end"><Plus data-icon="inline-start" />{busy ? "Saving…" : "Save customer"}</Button>{error && <p role="alert" className="text-xs text-red-700 md:col-span-3">{error}</p>}</form>}
    <div className="hidden grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(200px,1.3fr)_100px_110px_100px] gap-4 border-b bg-muted/30 px-5 py-3 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground md:grid"><span>Customer</span><span>Phone</span><span>Latest conversation</span><span>Status</span><span>WhatsApp consent</span><span>Last active</span></div>
    <div className="divide-y">{visible.map((contact) => <Fragment key={contact.id}><div className="grid gap-3 px-4 py-4 transition-colors hover:bg-muted/30 md:grid-cols-[minmax(220px,1.4fr)_minmax(160px,1fr)_minmax(200px,1.3fr)_100px_110px_100px_auto] md:items-center md:gap-4 md:px-5"><Link href={`/?contact=${encodeURIComponent(contact.id)}`} className="flex min-w-0 items-center gap-3"><Avatar className="size-10"><AvatarFallback className={`${contact.color} text-xs`}>{contact.initials}</AvatarFallback></Avatar><div className="min-w-0"><div className="truncate text-sm font-medium">{contact.name}</div><div className="mt-0.5 flex items-center gap-2">{contact.label && <Badge variant="secondary" className="px-1.5 py-0 text-[9px]">{contact.label}</Badge>}<span className="text-[10px] text-muted-foreground">{contact.messageCount ?? contact.messages?.length ?? 0} messages</span></div></div></Link><div className="text-xs text-muted-foreground">{contact.phone}</div><div className="truncate text-xs text-muted-foreground">{contact.preview}</div><div><Badge variant={contact.state === "Resolved" ? "outline" : "success"}>{contact.state ?? "Open"}</Badge></div><div><Badge variant="outline" className={contact.messagingConsent === "opted_in" ? "border-emerald-300 bg-emerald-50 text-emerald-800" : contact.messagingConsent === "opted_out" ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-900"}>{contact.messagingConsent === "opted_in" ? "Opted in" : contact.messagingConsent === "opted_out" ? "Opted out" : "Not recorded"}</Badge></div><div className="flex items-center justify-between text-xs text-muted-foreground"><span>{contact.time}</span><ArrowUpRight className="size-3.5" /></div><div className="flex flex-wrap items-center gap-2">{canEditProfiles && <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => editingId === contact.id ? setEditingId("") : beginEdit(contact)}><Pencil data-icon="inline-start" />{editingId === contact.id ? "Close" : "Edit"}</Button>}{canManagePrivacy && <><Button asChild variant="outline" size="sm"><a href={`/api/contacts/${encodeURIComponent(contact.id)}/export`} aria-label={`Export ${contact.name} data`}><ArrowDownToLine data-icon="inline-start" />Export</a></Button><Button asChild variant="outline" size="sm"><a href={`/api/contacts/${encodeURIComponent(contact.id)}/export?includeMedia=1`} aria-label={`Export ${contact.name} data with attachments`}><ArrowDownToLine data-icon="inline-start" />With files</a></Button></>}{canManagePrivacy && <>{contact.legalHoldAt ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void privacyAction(contact, "release")} title={contact.legalHoldReason ?? "Legal hold active"}><ShieldOff data-icon="inline-start" />Release hold</Button> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void privacyAction(contact, "hold")}><ShieldAlert data-icon="inline-start" />Legal hold</Button>}<Button type="button" size="sm" variant="destructive" disabled={busy || !!contact.legalHoldAt} onClick={() => void privacyAction(contact, "delete")} title={contact.legalHoldAt ? "Release legal hold before deleting" : "Delete customer and history"}><Trash2 data-icon="inline-start" />Delete</Button></>}</div></div>
      {canEditProfiles && editingId === contact.id && <form onSubmit={(event) => void saveContact(event, contact)} className="grid gap-3 border-b bg-muted/40 p-4 md:grid-cols-3"><label className="flex flex-col gap-1.5 text-xs font-medium">Name<Input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Primary WhatsApp number<Input required value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /><span className="font-normal text-muted-foreground">International format, for example +14155550123.</span></label><label className="flex flex-col gap-1.5 text-xs font-medium">Email<Input type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Source<Input maxLength={200} value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })} placeholder="Referral, website, event…" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Owner<SelectControl value={draft.ownerUserId} onChange={(event) => setDraft({ ...draft, ownerUserId: event.target.value })} className="h-9 rounded-md border bg-white px-3 text-sm"><option value="">Unassigned</option>{owners.map((owner) => <option key={owner.id} value={owner.id}>{owner.name}</option>)}</SelectControl></label><label className="flex flex-col gap-1.5 text-xs font-medium">Tags<Input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="VIP, Billing, Follow-up" /><span className="font-normal text-muted-foreground">Separate tags with commas.</span></label><label className="flex flex-col gap-1.5 text-xs font-medium md:col-span-3">Custom fields <Textarea value={draft.customFields} onChange={(event) => setDraft({ ...draft, customFields: event.target.value })} className="font-mono text-xs" /><span className="font-normal text-muted-foreground">JSON object with up to 30 short text, number, or yes/no values.</span></label>{error && <p role="alert" className="text-xs text-red-700 md:col-span-3">{error}</p>}<div className="flex justify-end gap-2 md:col-span-3"><Button type="button" variant="outline" disabled={busy} onClick={() => setEditingId("")}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save profile"}</Button></div></form>}</Fragment>)}
    {visible.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No customers match that search.</div>}</div>
  </section>;
}
