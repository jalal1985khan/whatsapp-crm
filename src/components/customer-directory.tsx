"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowDownToLine,
  FileUp,
  Filter,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldAlert,
  ShieldOff,
  Trash2,
  UserRoundPlus,
  X,
  AlertTriangle,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { SelectControl } from "@/components/ui/select-control";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ContactImport } from "@/components/contact-import";

type Contact = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  additionalPhones?: string[];
  email?: string;
  source?: string;
  ownerUserId?: string;
  ownerName?: string;
  tags?: string[];
  customFields?: Record<string, unknown>;
  preview: string;
  time: string;
  label?: string;
  color: string;
  state?: string;
  messagingConsent?: "unknown" | "opted_in" | "opted_out";
  legalHoldAt?: string | null;
  legalHoldReason?: string | null;
  messageCount?: number;
  messages?: unknown[];
};

type Owner = { id: string; name: string; email: string; role: string };
type DuplicatePair = {
  firstId: string;
  firstName: string;
  firstPhone: string;
  secondId: string;
  secondName: string;
  secondPhone: string;
  reasons: string[];
};
type SegmentFilters = {
  tag: string;
  source: string;
  ownerUserId: string;
  consent: "any" | "opted_in" | "opted_out" | "unknown";
};
type CustomerSegment = { id: string; name: string; filters: SegmentFilters };
const emptySegmentFilters: SegmentFilters = { tag: "", source: "", ownerUserId: "", consent: "any" };

export function CustomerDirectory({
  contacts,
  owners = [],
  canManagePrivacy = false,
  canEditProfiles = false,
  initialAdding = false,
}: {
  contacts: Contact[];
  owners?: Owner[];
  canManagePrivacy?: boolean;
  canEditProfiles?: boolean;
  initialAdding?: boolean;
}) {
  const [items, setItems] = useState(contacts);
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(initialAdding);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [segmentFormOpen, setSegmentFormOpen] = useState(false);
  const [draft, setDraft] = useState({
    name: "",
    phone: "",
    email: "",
    source: "",
    ownerUserId: "",
    tags: "",
    customFields: "{}",
  });
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
  const visible = useMemo(
    () =>
      items.filter((contact) => {
        if (
          !`${contact.name} ${contact.phone} ${(contact.additionalPhones ?? []).join(" ")} ${contact.label ?? ""}`
            .toLowerCase()
            .includes(query.toLowerCase())
        )
          return false;
        const filters = selectedSegment?.filters;
        if (!filters) return true;
        if (
          filters.tag &&
          !(contact.tags ?? (contact.label ? [contact.label] : [])).some(
            (tag) => tag.toLowerCase() === filters.tag.toLowerCase(),
          )
        )
          return false;
        if (filters.source && (contact.source ?? "").toLowerCase() !== filters.source.toLowerCase())
          return false;
        if (filters.ownerUserId && contact.ownerUserId !== filters.ownerUserId) return false;
        if (filters.consent !== "any" && (contact.messagingConsent ?? "unknown") !== filters.consent)
          return false;
        return true;
      }),
    [items, query, selectedSegment],
  );

  useEffect(() => {
    if (!canManagePrivacy) return;
    void fetch("/api/contacts/duplicates", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not check duplicate records.");
        if (Array.isArray(data.duplicates)) setDuplicates(data.duplicates);
      })
      .catch((cause) =>
        setDuplicateError(cause instanceof Error ? cause.message : "Could not check duplicate records."),
      );
  }, [canManagePrivacy]);

  useEffect(() => {
    if (!canManagePrivacy) return;
    void fetch("/api/customer-segments", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Could not load customer segments.");
        if (Array.isArray(data.segments)) setSegments(data.segments);
      })
      .catch((cause) =>
        setSegmentError(cause instanceof Error ? cause.message : "Could not load customer segments."),
      );
  }, [canManagePrivacy]);

  async function saveSegment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSegmentError("");
    try {
      const response = await fetch("/api/customer-segments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: segmentName, filters: segmentFilters }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not save this segment.");
      setSegments((current) => [...current, data.segment].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSegmentId(data.segment.id);
      setSegmentName("");
      setSegmentFilters(emptySegmentFilters);
      setSegmentFormOpen(false);
    } catch (cause) {
      setSegmentError(cause instanceof Error ? cause.message : "Could not save this segment.");
    }
  }

  async function deleteSegment() {
    if (
      !selectedSegment ||
      !window.confirm(`Delete the saved segment “${selectedSegment.name}”? Customer records will not be deleted.`)
    )
      return;
    setSegmentError("");
    try {
      const response = await fetch(`/api/customer-segments?id=${encodeURIComponent(selectedSegment.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete this segment.");
      setSegments((current) => current.filter((segment) => segment.id !== selectedSegment.id));
      setSelectedSegmentId("");
    } catch (cause) {
      setSegmentError(cause instanceof Error ? cause.message : "Could not delete this segment.");
    }
  }

  async function addContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not add customer.");
      setItems((current) => [data.contact, ...current]);
      setName("");
      setPhone("");
      setAdding(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add customer.");
    } finally {
      setBusy(false);
    }
  }

  function beginEdit(contact: Contact) {
    setEditingContact(contact);
    setDraft({
      name: contact.name,
      phone: contact.phone,
      email: contact.email ?? "",
      source: contact.source ?? "",
      ownerUserId: contact.ownerUserId ?? "",
      tags: (contact.tags ?? (contact.label ? [contact.label] : [])).join(", "),
      customFields: JSON.stringify(contact.customFields ?? {}, null, 2),
    });
    setError("");
  }

  async function saveContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingContact) return;
    setBusy(true);
    setError("");
    try {
      let customFields: unknown;
      try {
        customFields = JSON.parse(draft.customFields);
      } catch {
        throw new Error("Custom fields must be valid JSON.");
      }
      const response = await fetch(`/api/contacts/${encodeURIComponent(editingContact.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name,
          phone: draft.phone,
          email: draft.email,
          source: draft.source,
          ownerUserId: draft.ownerUserId || null,
          tags: draft.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
          customFields,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update customer details.");
      setItems((current) => current.map((item) => (item.id === editingContact.id ? { ...item, ...data.chat } : item)));
      setEditingContact(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update customer details.");
    } finally {
      setBusy(false);
    }
  }

  async function mergePair(pair: DuplicatePair) {
    const pairKey = `${pair.firstId}:${pair.secondId}`;
    const targetId = mergeTargetByPair[pairKey] ?? pair.firstId;
    const sourceId = targetId === pair.firstId ? pair.secondId : pair.firstId;
    const targetName = targetId === pair.firstId ? pair.firstName : pair.secondName;
    const sourceName = sourceId === pair.firstId ? pair.firstName : pair.secondName;
    if (
      !window.confirm(
        `Merge ${sourceName} into ${targetName}? Messages, notes, consent history and phone identifiers will move to the retained record. The source contact ID will remain as a merge record.`,
      )
    )
      return;
    setBusy(true);
    setDuplicateError("");
    try {
      const response = await fetch("/api/contacts/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceId, targetId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not merge customer records.");
      window.location.reload();
    } catch (cause) {
      setDuplicateError(cause instanceof Error ? cause.message : "Could not merge customer records.");
    } finally {
      setBusy(false);
    }
  }

  async function privacyAction(contact: Contact, action: "hold" | "release" | "delete") {
    setPrivacyError("");
    const reason =
      action === "hold" ? window.prompt("Reason for legal hold (recorded in the audit log):")?.trim() : undefined;
    if (action === "hold" && !reason) return;
    if (action === "release" && !window.confirm(`Release the legal hold for ${contact.name}?`)) return;
    if (
      action === "delete" &&
      !window.confirm(`Permanently delete ${contact.name} and their CRM conversation history? This cannot be undone.`)
    )
      return;
    setBusy(true);
    try {
      const response = await fetch(`/api/contacts/${encodeURIComponent(contact.id)}/privacy`, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: action === "delete" ? undefined : JSON.stringify({ action, reason }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update customer privacy settings.");
      if (action === "delete") setItems((current) => current.filter((item) => item.id !== contact.id));
      else
        setItems((current) =>
          current.map((item) =>
            item.id === contact.id
              ? {
                  ...item,
                  legalHoldAt: action === "hold" ? new Date().toISOString() : null,
                  legalHoldReason: action === "hold" ? reason : null,
                }
              : item,
          ),
        );
    } catch (cause) {
      setPrivacyError(cause instanceof Error ? cause.message : "Could not update customer privacy settings.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Search and Action Toolbar */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <div className="relative w-full max-w-sm">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search customers by name, phone, tag…"
                  className="pl-9"
                />
              </div>
              {canManagePrivacy && (
                <>
                  <SelectControl
                    aria-label="Customer segment"
                    value={selectedSegmentId}
                    onChange={(event) => setSelectedSegmentId(event.target.value)}
                    className="h-9 min-w-44 rounded-md border bg-card px-3 text-sm text-foreground"
                  >
                    <option value="">All customers</option>
                    {segments.map((segment) => (
                      <option key={segment.id} value={segment.id}>
                        {segment.name}
                      </option>
                    ))}
                  </SelectControl>
                  {selectedSegment && (
                    <Button type="button" size="sm" variant="ghost" onClick={() => void deleteSegment()}>
                      Delete segment
                    </Button>
                  )}
                  <Button
                    type="button"
                    size="sm"
                    variant={segmentFormOpen ? "secondary" : "outline"}
                    onClick={() => setSegmentFormOpen((v) => !v)}
                  >
                    <Filter className="size-3.5" />
                    {segmentFormOpen ? "Close filter" : "New segment"}
                  </Button>
                </>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Showing {visible.length} of {items.length}
              </span>
              {canManagePrivacy && (
                <Button
                  type="button"
                  size="sm"
                  variant={importOpen ? "secondary" : "outline"}
                  onClick={() => setImportOpen((v) => !v)}
                >
                  <FileUp className="size-3.5" />
                  {importOpen ? "Close import" : "Import CSV"}
                </Button>
              )}
              <Button size="sm" onClick={() => setAdding((v) => !v)}>
                {adding ? <X className="size-3.5" /> : <UserRoundPlus className="size-3.5" />}
                {adding ? "Cancel" : "Add customer"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* New Segment Form (collapsible) */}
      {segmentFormOpen && canManagePrivacy && (
        <Card className="border-primary/20 bg-muted/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Create Customer Segment</CardTitle>
            <CardDescription className="text-xs">
              Save filter presets to target and segment your customer base.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(event) => void saveSegment(event)}
              className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_1fr_1fr_auto]"
            >
              <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground">
                Segment name
                <Input
                  required
                  maxLength={40}
                  value={segmentName}
                  onChange={(event) => setSegmentName(event.target.value)}
                  placeholder="e.g. VIP Clients"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground">
                Tag
                <Input
                  maxLength={80}
                  value={segmentFilters.tag}
                  onChange={(event) => setSegmentFilters({ ...segmentFilters, tag: event.target.value })}
                  placeholder="VIP"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground">
                Source
                <Input
                  maxLength={200}
                  value={segmentFilters.source}
                  onChange={(event) => setSegmentFilters({ ...segmentFilters, source: event.target.value })}
                  placeholder="Website"
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground">
                Owner
                <SelectControl
                  value={segmentFilters.ownerUserId}
                  onChange={(event) => setSegmentFilters({ ...segmentFilters, ownerUserId: event.target.value })}
                  className="h-9 rounded-md border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">Any owner</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </SelectControl>
              </label>
              <label className="flex flex-col gap-1 text-[11px] font-medium text-foreground">
                Consent
                <SelectControl
                  value={segmentFilters.consent}
                  onChange={(event) =>
                    setSegmentFilters({
                      ...segmentFilters,
                      consent: event.target.value as SegmentFilters["consent"],
                    })
                  }
                  className="h-9 rounded-md border bg-card px-3 text-sm text-foreground"
                >
                  <option value="any">Any consent</option>
                  <option value="opted_in">Opted in</option>
                  <option value="opted_out">Opted out</option>
                  <option value="unknown">Not recorded</option>
                </SelectControl>
              </label>
              <Button type="submit" size="default" className="self-end">
                Save segment
              </Button>
              {segmentError && (
                <p role="alert" className="text-xs text-destructive md:col-span-6">
                  {segmentError}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* CSV Import */}
      {importOpen && canManagePrivacy && (
        <Card>
          <CardContent className="p-4">
            <ContactImport onImported={() => window.location.reload()} />
          </CardContent>
        </Card>
      )}

      {/* Add Customer Inline Form */}
      {adding && (
        <Card className="border-primary/20 bg-muted/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Add New Customer</CardTitle>
            <CardDescription className="text-xs">
              Enter customer details to initiate WhatsApp conversations.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={addContact} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Customer name
                <Input
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. John Doe"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                WhatsApp phone number
                <Input
                  required
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+14155550123"
                />
              </label>
              <Button type="submit" disabled={busy} className="self-end">
                <Plus className="size-3.5" />
                {busy ? "Saving…" : "Save customer"}
              </Button>
              {error && (
                <p role="alert" className="text-xs text-destructive md:col-span-3">
                  {error}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {/* Duplicates Banner - only shown when duplicates actually exist! */}
      {canManagePrivacy && duplicates.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600" />
                <CardTitle className="text-sm font-semibold text-amber-900">Possible Duplicates</CardTitle>
              </div>
              <Badge variant="secondary">{duplicates.length} pairs</Badge>
            </div>
            <CardDescription className="text-xs text-amber-800">
              Review matching names, emails, or phone history. Pick which record to keep.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {duplicateError && (
              <p role="alert" className="text-xs text-destructive">
                {duplicateError}
              </p>
            )}
            <div className="divide-y rounded-lg border bg-card">
              {duplicates.map((pair) => {
                const key = `${pair.firstId}:${pair.secondId}`;
                const targetId = mergeTargetByPair[key] ?? pair.firstId;
                return (
                  <div key={key} className="flex flex-wrap items-center justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {pair.firstName} · {pair.firstPhone}{" "}
                        <span className="text-muted-foreground font-normal">and</span> {pair.secondName} ·{" "}
                        {pair.secondPhone}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">Matched by {pair.reasons.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] text-muted-foreground">Keep</label>
                      <SelectControl
                        value={targetId}
                        onChange={(event) =>
                          setMergeTargetByPair((current) => ({ ...current, [key]: event.target.value }))
                        }
                        className="h-8 max-w-[180px] rounded-md border bg-card px-2 text-xs text-foreground"
                      >
                        <option value={pair.firstId}>
                          {pair.firstName} · {pair.firstPhone}
                        </option>
                        <option value={pair.secondId}>
                          {pair.secondName} · {pair.secondPhone}
                        </option>
                      </SelectControl>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void mergePair(pair)}>
                        Merge
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {privacyError && (
        <div role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
          {privacyError}
        </div>
      )}

      {/* Customer Table */}
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[280px]">Customer</TableHead>
              <TableHead className="w-[160px]">Phone</TableHead>
              <TableHead className="min-w-[180px]">Latest conversation</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[130px]">WhatsApp consent</TableHead>
              <TableHead className="w-[110px]">Last active</TableHead>
              <TableHead className="w-[90px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((contact) => (
              <TableRow key={contact.id} className="group">
                {/* Customer name & avatar */}
                <TableCell>
                  <Link
                    href={`/?contact=${encodeURIComponent(contact.id)}`}
                    className="flex items-center gap-3 hover:opacity-85"
                  >
                    <Avatar className="size-9">
                      <AvatarFallback className="bg-primary/10 text-primary font-medium text-xs">
                        {contact.initials}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-medium text-foreground">{contact.name}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        {contact.label && (
                          <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                            {contact.label}
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground">
                          {contact.messageCount ?? contact.messages?.length ?? 0} messages
                        </span>
                      </div>
                    </div>
                  </Link>
                </TableCell>

                {/* Phone */}
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{contact.phone}</span>
                </TableCell>

                {/* Latest conversation preview */}
                <TableCell>
                  <span className="block max-w-[240px] truncate text-xs text-muted-foreground">
                    {contact.preview}
                  </span>
                </TableCell>

                {/* Status */}
                <TableCell>
                  <Badge variant={contact.state === "Resolved" ? "outline" : "secondary"}>
                    {contact.state ?? "Open"}
                  </Badge>
                </TableCell>

                {/* Consent */}
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      contact.messagingConsent === "opted_in"
                        ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                        : contact.messagingConsent === "opted_out"
                        ? "border-destructive/30 bg-destructive/10 text-destructive"
                        : "border-amber-300 bg-amber-50 text-amber-900"
                    }
                  >
                    {contact.messagingConsent === "opted_in"
                      ? "Opted in"
                      : contact.messagingConsent === "opted_out"
                      ? "Opted out"
                      : "Not recorded"}
                  </Badge>
                </TableCell>

                {/* Last Active */}
                <TableCell className="text-xs text-muted-foreground">{contact.time}</TableCell>

                {/* Actions: Open chat link + dropdown menu */}
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button asChild size="icon" variant="ghost" className="size-8" title="Open chat">
                      <Link href={`/?contact=${encodeURIComponent(contact.id)}`}>
                        <MessageSquare className="size-4 text-muted-foreground hover:text-foreground" />
                      </Link>
                    </Button>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-muted-foreground hover:text-foreground"
                          title="More options"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48">
                        {canEditProfiles && (
                          <DropdownMenuItem onClick={() => beginEdit(contact)}>
                            <Pencil className="mr-2 size-4" />
                            Edit profile
                          </DropdownMenuItem>
                        )}
                        {canManagePrivacy && (
                          <>
                            <DropdownMenuItem asChild>
                              <a href={`/api/contacts/${encodeURIComponent(contact.id)}/export`}>
                                <ArrowDownToLine className="mr-2 size-4" />
                                Export data
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuItem asChild>
                              <a href={`/api/contacts/${encodeURIComponent(contact.id)}/export?includeMedia=1`}>
                                <ArrowDownToLine className="mr-2 size-4" />
                                Export with files
                              </a>
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            {contact.legalHoldAt ? (
                              <DropdownMenuItem
                                onClick={() => void privacyAction(contact, "release")}
                                title={contact.legalHoldReason ?? "Legal hold active"}
                              >
                                <ShieldOff className="mr-2 size-4" />
                                Release hold
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem onClick={() => void privacyAction(contact, "hold")}>
                                <ShieldAlert className="mr-2 size-4" />
                                Legal hold
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-destructive focus:text-destructive"
                              disabled={busy || !!contact.legalHoldAt}
                              onClick={() => void privacyAction(contact, "delete")}
                            >
                              <Trash2 className="mr-2 size-4" />
                              Delete customer
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </TableCell>
              </TableRow>
            ))}

            {visible.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center text-sm text-muted-foreground">
                  No customers match that search.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Edit Customer Dialog */}
      <Dialog
        open={Boolean(editingContact)}
        onOpenChange={(open) => {
          if (!open) setEditingContact(null);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Customer Profile</DialogTitle>
            <DialogDescription>
              Update contact information and tags for {editingContact?.name}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={saveContact} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Name
                <Input
                  required
                  value={draft.name}
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Primary WhatsApp number
                <Input
                  required
                  value={draft.phone}
                  onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Email
                <Input
                  type="email"
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  placeholder="name@example.com"
                />
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Source
                <Input
                  maxLength={200}
                  value={draft.source}
                  onChange={(event) => setDraft({ ...draft, source: event.target.value })}
                  placeholder="Referral, website, event…"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Owner
                <SelectControl
                  value={draft.ownerUserId}
                  onChange={(event) => setDraft({ ...draft, ownerUserId: event.target.value })}
                  className="h-9 rounded-md border bg-card px-3 text-sm text-foreground"
                >
                  <option value="">Unassigned</option>
                  {owners.map((owner) => (
                    <option key={owner.id} value={owner.id}>
                      {owner.name}
                    </option>
                  ))}
                </SelectControl>
              </label>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
                Tags
                <Input
                  value={draft.tags}
                  onChange={(event) => setDraft({ ...draft, tags: event.target.value })}
                  placeholder="VIP, Billing, Follow-up"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-foreground">
              Custom fields (JSON)
              <Textarea
                value={draft.customFields}
                onChange={(event) => setDraft({ ...draft, customFields: event.target.value })}
                className="font-mono text-xs"
                rows={3}
              />
            </label>

            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditingContact(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save profile"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
