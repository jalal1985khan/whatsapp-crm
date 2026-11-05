"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function PasswordResetForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/password/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not reset the password.");
      window.history.replaceState(null, "", "/reset-password");
      setDone(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not reset the password."); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10"><section className="w-full max-w-[420px] rounded-2xl border bg-card p-8 shadow-sm"><div className="mb-8 flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><LockKeyhole className="size-5" /></div><div><div className="text-lg font-semibold">Relay CRM</div><div className="text-xs text-muted-foreground">Account recovery</div></div></div><h1 className="text-xl font-semibold">Choose a new password</h1><p className="mt-1 text-sm text-muted-foreground">Use at least 12 characters. Existing sign-in sessions will be revoked.</p>
    {!done ? <form onSubmit={submit} className="mt-6 flex flex-col gap-4"><label className="flex flex-col gap-1.5 text-sm font-medium">New password<Input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label className="flex flex-col gap-1.5 text-sm font-medium">Confirm new password<Input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label>{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Updating…" : "Reset password"}</Button></form> : <div role="status" className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">Your password was changed. Sign in with your new password.</div>}
    <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to sign in</Link></section></main>;
}
