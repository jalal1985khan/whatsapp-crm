"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Policy = { deleteResolvedContactsAfterDays: number };

export function RetentionManager() {
  const [days, setDays] = useState("0");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/admin/retention", { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load retention settings.");
      setDays(String((data.policy as Policy).deleteResolvedContactsAfterDays));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load retention settings.")).finally(() => setLoading(false));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const value = Number(days);
    if (!Number.isInteger(value) || (value !== 0 && (value < 30 || value > 3650))) { setError("Choose 0 to disable automatic deletion, or a value from 30 to 3,650 days."); setBusy(false); return; }
    try {
      const response = await fetch("/api/admin/retention", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ policy: { deleteResolvedContactsAfterDays: value } }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save retention settings.");
      setNotice(value === 0 ? "Scheduled deletion is disabled." : `Resolved customer records older than ${value} days are now eligible for scheduled deletion.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save retention settings."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Resolved customer retention</h2><p className="mt-1 text-xs text-muted-foreground">Choose how long resolved customer records remain in the CRM.</p></div><Badge variant={days === "0" ? "secondary" : "outline"}>{days === "0" ? "Automatic deletion off" : `${days} day policy`}</Badge></div>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>}
    <form onSubmit={save} className="flex max-w-xl flex-col gap-3 sm:flex-row sm:items-end">
      <label className="flex flex-1 flex-col gap-1.5 text-xs font-medium">Delete after (days)<Input type="number" min="0" max="3650" step="1" value={days} disabled={loading || busy} onChange={(event) => setDays(event.target.value)} aria-describedby="retention-help" /></label>
      <Button type="submit" disabled={loading || busy}>{busy ? "Saving…" : "Save policy"}</Button>
    </form>
    <p id="retention-help" className="mt-2 max-w-2xl text-xs leading-relaxed text-muted-foreground">Set 0 to disable scheduled deletion. Otherwise, a daily scheduled cleanup permanently removes customer records only when every conversation is resolved and the last activity is older than the selected period. Records under legal hold are skipped. Deletion removes messages, notes, consent history and identifiers, scrubs matching stored webhook payloads, and writes an audit event. Choose 30–3,650 days.</p>
    <p className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">To run the schedule, configure a daily external job to POST to <code className="font-mono text-foreground">/api/admin/retention</code> with the <code className="font-mono text-foreground">RETENTION_CLEANUP_SECRET</code> bearer token. Keep the secret in your scheduler’s secret store.</p>
  </section>;
}
