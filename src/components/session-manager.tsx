"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LaptopMinimal, LogOut, MonitorSmartphone, RefreshCw, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type SessionRow = { id: string; sourceIp: string | null; userAgent: string | null; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean };

function browserLabel(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const browser = userAgent.includes("Edg/") ? "Microsoft Edge" : userAgent.includes("Firefox/") ? "Firefox" : userAgent.includes("Chrome/") ? "Chrome" : userAgent.includes("Safari/") ? "Safari" : "Browser";
  const device = /iPhone|iPad|Android|Mobile/i.test(userAgent) ? "Mobile device" : /Mac OS|Macintosh/i.test(userAgent) ? "Mac" : /Windows/i.test(userAgent) ? "Windows PC" : /Linux/i.test(userAgent) ? "Linux device" : "Computer";
  return `${browser} on ${device}`;
}

function formatDate(value: string) { return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }

async function fetchSessions(): Promise<SessionRow[]> {
  const response = await fetch("/api/auth/sessions", { cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load sign-in sessions.");
  return data.sessions;
}

export function SessionManager() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [mfa, setMfa] = useState<{ enabled: boolean; pending: boolean }>({ enabled: false, pending: false });
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaUri, setMfaUri] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);

  const refresh = useCallback(async () => setSessions(await fetchSessions()), []);

  useEffect(() => {
    let active = true;
    fetchSessions().then((rows) => { if (active) setSessions(rows); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load sign-in sessions."); });
    fetch("/api/auth/mfa", { cache: "no-store" }).then((response) => response.json()).then((data) => { if (active && typeof data.enabled === "boolean") setMfa(data); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  async function manageMfa(action: "begin" | "replace_begin" | "confirm" | "disable") {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/mfa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, code: mfaCode }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update authenticator security.");
      if (action === "begin" || action === "replace_begin") { setMfaSecret(data.secret); setMfaUri(data.otpauthUrl); setMfa((value) => ({ ...value, pending: true })); setMfaCode(""); }
      if (action === "confirm") { setMfa({ enabled: true, pending: false }); setRecoveryCodes(data.recoveryCodes); setMfaSecret(""); setMfaUri(""); setMfaCode(""); setNotice(data.otherSessionsRevoked ? "Authenticator confirmed. Other sign-in sessions were signed out." : "Authenticator confirmed."); await refresh(); }
      if (action === "disable") { setMfa({ enabled: false, pending: false }); setRecoveryCodes([]); setMfaCode(""); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update authenticator security."); }
    finally { setBusy(false); }
  }

  async function revoke(sessionId?: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/auth/sessions", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify(sessionId ? { sessionId } : { revokeOthers: true }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not revoke sign-in sessions.");
      if (data.currentRevoked) {
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
        return;
      }
      await refresh();
      setNotice(data.revoked ? `${data.revoked} session${data.revoked === 1 ? "" : "s"} revoked.` : "No other active sessions were found.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not revoke sign-in sessions."); }
    finally { setBusy(false); }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    if (newPassword !== confirmPassword) { setError("The new passwords do not match."); setBusy(false); return; }
    try {
      const response = await fetch("/api/auth/password", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword, newPassword }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change the password.");
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      await refresh();
      setNotice(`Password changed. ${data.revokedOtherSessions} other session${data.revokedOtherSessions === 1 ? " was" : "s were"} signed out.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not change the password."); }
    finally { setBusy(false); }
  }

  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
    {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Authenticator security</h2><p className="mt-1 text-xs text-muted-foreground">Require a time-based code when signing in to owner and admin accounts. Confirming or replacing MFA signs out other active sessions.</p></div><Badge variant={mfa.enabled ? "success" : "secondary"}>{mfa.enabled ? "Enabled" : "Not enabled"}</Badge></div>
      {!mfa.enabled && !mfa.pending && <Button type="button" disabled={busy} onClick={() => void manageMfa("begin")}>Set up authenticator</Button>}
      {mfa.enabled && !mfa.pending && <div className="flex max-w-lg flex-col gap-3"><label className="flex flex-col gap-1.5 text-xs font-medium">Current authenticator or recovery code<Input inputMode="numeric" autoComplete="one-time-code" maxLength={32} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label><Button type="button" variant="outline" disabled={busy || !mfaCode} onClick={() => void manageMfa("replace_begin")}>Replace authenticator</Button><p className="text-[11px] text-muted-foreground">Your current authenticator remains active until you confirm the replacement.</p></div>}
      {mfa.pending && <div className="flex max-w-lg flex-col gap-3"><p className="text-sm">{mfa.enabled ? "Add the new key to your authenticator app, then confirm it. Your current factor remains active until then." : "Add this key to an authenticator app, then enter the 6-digit code it shows."}</p><code className="break-all rounded-lg bg-muted p-3 text-sm">{mfaSecret}</code><details className="text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Can’t scan a QR code?</summary><p className="mt-2 break-all">Use this setup link in your authenticator app: {mfaUri}</p></details><div className="flex gap-2"><Input aria-label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="6-digit code" /><Button type="button" disabled={busy || mfaCode.length !== 6} onClick={() => void manageMfa("confirm")}>{mfa.enabled ? "Confirm replacement" : "Confirm setup"}</Button></div></div>}
      {mfa.enabled && <div className="flex max-w-lg flex-col gap-3"><label className="flex flex-col gap-1.5 text-xs font-medium">Enter authenticator or recovery code to turn MFA off<Input inputMode="numeric" autoComplete="one-time-code" maxLength={32} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /></label><Button type="button" variant="outline" disabled={busy || !mfaCode} onClick={() => void manageMfa("disable")}>Turn off MFA</Button></div>}
      {recoveryCodes.length > 0 && <div className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="text-sm font-semibold">Save these recovery codes now</h3><p className="mt-1 text-xs text-amber-900">Each code works once. They will not be shown again.</p><div className="mt-3 grid grid-cols-2 gap-2 font-mono text-xs">{recoveryCodes.map((code) => <code key={code} className="rounded bg-white p-2">{code}</code>)}</div><Button className="mt-3" size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(recoveryCodes.join("\n"))}>Copy codes</Button></div>}
    </section>
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 p-5"><div className="flex items-center gap-3"><div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-4" /></div><div><h2 className="text-sm font-semibold">Active sign-ins</h2><p className="mt-1 text-xs text-muted-foreground">Sessions expire after 12 hours. Revoking takes effect on the next request.</p></div></div><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh().catch((cause) => setError(cause instanceof Error ? cause.message : "Refresh failed."))}><RefreshCw data-icon="inline-start" />Refresh</Button><Button type="button" variant="outline" size="sm" disabled={busy || sessions.filter((session) => !session.current).length === 0} onClick={() => void revoke()}><LogOut data-icon="inline-start" />Sign out other sessions</Button></div></div>
      <Separator />
      <div className="divide-y">{sessions.map((session) => <div key={session.id} className="flex flex-wrap items-center gap-4 p-5"><div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600">{/Mobile|iPhone|iPad|Android/i.test(session.userAgent ?? "") ? <MonitorSmartphone className="size-5" /> : <LaptopMinimal className="size-5" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{browserLabel(session.userAgent)}</p>{session.current && <Badge variant="success">This session</Badge>}</div><p className="mt-1 truncate text-xs text-muted-foreground">{session.sourceIp || "IP unavailable"} · Last active {formatDate(session.lastSeenAt)}</p><p className="mt-1 text-[11px] text-muted-foreground">Signed in {formatDate(session.createdAt)} · Expires {formatDate(session.expiresAt)}</p></div>{!session.current && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void revoke(session.id)}>Revoke</Button>}</div>)}
        {sessions.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No active sign-in sessions were found. Refresh after signing in again.</p>}</div>
    </section>
    <section className="rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4"><h2 className="text-sm font-semibold">Change password</h2><p className="mt-1 text-xs text-muted-foreground">Changing your password signs out other active sessions.</p></div><form onSubmit={changePassword} className="grid gap-3 sm:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-medium sm:col-span-2">Current password<Input type="password" autoComplete="current-password" required maxLength={1024} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} /></label><label className="flex flex-col gap-1.5 text-xs font-medium">New password<Input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Confirm new password<Input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label><div className="flex items-center justify-between gap-3 sm:col-span-2"><p className="text-[11px] text-muted-foreground">Use at least 12 characters.</p><Button type="submit" disabled={busy || !currentPassword || !newPassword || !confirmPassword}>{busy ? "Saving…" : "Update password"}</Button></div></form></section>
    <p className="text-xs leading-relaxed text-muted-foreground">Device labels are estimated from the browser information sent at sign-in. In local development, session records are kept in process memory and can disappear when the server restarts.</p>
  </div>;
}
