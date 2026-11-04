"use client";

import { CheckboxControl } from "@/components/ui/checkbox-control";

import { FormEvent, useState } from "react";
import { Pencil, Plus, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Reply = { id: string; title: string; shortcut: string | null; body: string; sortOrder: number; isActive: boolean };
const empty = { title: "", shortcut: "", body: "", sortOrder: 100, isActive: true };

export function CannedReplyAdmin({ initialReplies, setupError }: { initialReplies: Reply[]; setupError: string }) {
  const [replies, setReplies] = useState(initialReplies);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(empty);
  const [error, setError] = useState(setupError);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function edit(reply?: Reply) {
    setEditingId(reply?.id ?? "");
    setForm(reply ? { title: reply.title, shortcut: reply.shortcut ?? "", body: reply.body, sortOrder: reply.sortOrder, isActive: reply.isActive } : empty);
    setError(""); setNotice("");
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const payload = { ...form, shortcut: form.shortcut.trim().replace(/^;/, "").toLowerCase() || null };
      const response = await fetch("/api/canned-replies", { method: editingId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editingId ? { id: editingId, ...payload } : payload) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save this reply.");
      const message = editingId ? "Saved reply updated." : "Saved reply created.";
      setReplies((current) => editingId ? current.map((reply) => reply.id === editingId ? data.reply : reply) : [...current, data.reply].sort((a: Reply, b: Reply) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title)));
      edit(); setNotice(message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this reply."); }
    finally { setBusy(false); }
  }

  async function toggle(reply: Reply) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/canned-replies", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: reply.id, isActive: !reply.isActive }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not change reply status.");
      setReplies((current) => current.map((item) => item.id === reply.id ? data.reply : item)); setNotice(data.reply.isActive ? "Saved reply activated." : "Saved reply deactivated.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change reply status."); }
    finally { setBusy(false); }
  }

  return <div className="flex flex-col gap-5">{(error || notice) && <div role={error ? "alert" : "status"} className={`rounded-lg border px-4 py-3 text-sm ${error ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-900"}`}>{error || notice}</div>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-sm font-semibold">{editingId ? "Edit saved reply" : "Create a saved reply"}</h2><p className="mt-1 text-xs text-muted-foreground">Use <code>{"{{customer_name}}"}</code> or <code>{"{{agent_name}}"}</code> for automatic personalization. Shortcut examples: <code>thanks</code>, inserted by typing <code>;thanks</code> followed by a space.</p></div><form onSubmit={(event) => void save(event)} className="grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-medium">Reply title<Input required maxLength={80} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Thank the customer" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Shortcut <span className="font-normal text-muted-foreground">Optional · letters, numbers, hyphens, underscores</span><Input maxLength={25} value={form.shortcut} onChange={(event) => setForm({ ...form, shortcut: event.target.value.replace(/^;/, "") })} placeholder="thanks" /></label><label className="flex flex-col gap-1.5 text-xs font-medium md:col-span-2">Reply text<Textarea required maxLength={4000} rows={4} value={form.body} onChange={(event) => setForm({ ...form, body: event.target.value })} placeholder="Hi {{customer_name}}, thank you for reaching out…" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Display order<Input type="number" min={0} max={10000} value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label><label className="flex items-center gap-2 self-end pb-2 text-xs"><CheckboxControl aria-label="Available to agents" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />Available to agents</label><div className="flex justify-end gap-2 md:col-span-2">{editingId && <Button type="button" variant="outline" disabled={busy} onClick={() => edit()}><X data-icon="inline-start" />Cancel</Button>}<Button type="submit" disabled={busy}><Save data-icon="inline-start" />{busy ? "Saving…" : editingId ? "Save changes" : "Create reply"}</Button></div></form></section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm"><div className="flex items-center justify-between border-b p-5"><div><h2 className="text-sm font-semibold">Team reply library</h2><p className="mt-1 text-xs text-muted-foreground">{replies.filter((reply) => reply.isActive).length} active · {replies.length} total</p></div><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => edit()}><Plus data-icon="inline-start" />New reply</Button></div>{replies.length ? <div className="divide-y">{replies.map((reply) => <div key={reply.id} className="flex flex-wrap items-start gap-3 p-4"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{reply.title}</h3><Badge variant={reply.isActive ? "success" : "outline"}>{reply.isActive ? "Active" : "Inactive"}</Badge>{reply.shortcut && <Badge variant="secondary">;{reply.shortcut}</Badge>}</div><p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-xs text-muted-foreground">{reply.body}</p></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => edit(reply)}><Pencil data-icon="inline-start" />Edit</Button><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void toggle(reply)}>{reply.isActive ? "Deactivate" : "Activate"}</Button></div></div>)}</div> : <div className="p-10 text-center text-sm text-muted-foreground">No saved replies yet.</div>}</section>
  </div>;
}
