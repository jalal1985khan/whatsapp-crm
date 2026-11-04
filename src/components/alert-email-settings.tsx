"use client";

import { FormEvent, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AlertEmailSettings() {
  const [enabled, setEnabled] = useState(false);
  const [emails, setEmails] = useState("");
  const [deliveryConfigured, setDeliveryConfigured] = useState(false);
  const [schedulerConfigured, setSchedulerConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/admin/alerts/settings", { cache: "no-store" }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not load email alert settings.");
      setEnabled(Boolean(data.enabled)); setEmails(Array.isArray(data.emails) ? data.emails.join(", ") : ""); setDeliveryConfigured(Boolean(data.deliveryConfigured)); setSchedulerConfigured(Boolean(data.schedulerConfigured));
    }).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load email alert settings.")).finally(() => setLoading(false));
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const recipients = [...new Set(emails.split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))];
    try {
      const response = await fetch("/api/admin/alerts/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled, emails: recipients }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save email alert settings.");
      setEmails(data.emails.join(", ")); setNotice(enabled ? "Critical and warning email alerts are enabled." : "Email alerts are disabled.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save email alert settings."); }
    finally { setBusy(false); }
  }

  return <section className="rounded-2xl border bg-white p-5 shadow-sm">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Critical-event email alerts</h2><p className="mt-1 text-xs text-muted-foreground">Send admin alerts for number, account, webhook, authorization, and failover events.</p></div><Badge variant={enabled ? "success" : "secondary"}>{enabled ? "Enabled" : "Disabled"}</Badge></div>
    {error && <p role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
    {notice && <p role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">{notice}</p>}
    <form onSubmit={save} className="flex max-w-2xl flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-xs font-medium">Administrator email recipients<Input type="text" value={emails} disabled={loading || busy} onChange={(event) => setEmails(event.target.value)} placeholder="ops@example.com, admin@example.com" aria-describedby="email-alert-help" /></label>
      <p id="email-alert-help" className="text-[11px] text-muted-foreground">Enter up to 10 addresses separated by commas, spaces, or semicolons. Only warning and critical alerts are emailed.</p>
      <div className="flex flex-wrap items-center gap-3"><Button type="button" variant={enabled ? "secondary" : "outline"} disabled={loading || busy} onClick={() => setEnabled((value) => !value)}>{enabled ? "Email alerts on" : "Turn email alerts on"}</Button><Button type="submit" disabled={loading || busy}>{busy ? "Saving…" : "Save email settings"}</Button></div>
    </form>
    <div className="mt-5 grid gap-2 text-xs sm:grid-cols-2"><p>Resend: <Badge variant={deliveryConfigured ? "success" : "warning"}>{deliveryConfigured ? "Configured" : "Needs server setup"}</Badge></p><p>Delivery schedule: <Badge variant={schedulerConfigured ? "success" : "warning"}>{schedulerConfigured ? "Configured" : "Needs server setup"}</Badge></p></div>
    <p className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">Email delivery uses an outbox. Configure <code className="font-mono text-foreground">ALERT_EMAIL_SECRET</code>, then schedule a frequent POST to <code className="font-mono text-foreground">/api/admin/alerts/deliver</code> with its bearer token. Failed sends retry up to five times; Resend idempotency keys prevent duplicate delivery during retries.</p>
  </section>;
}
