"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowLeft, LockKeyhole, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/auth/password/forgot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not request a password reset.");
      setSent(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not request a password reset."); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4 py-10"><section className="w-full max-w-[420px] rounded-2xl border bg-card p-8 shadow-sm"><div className="mb-8 flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground"><LockKeyhole className="size-5" /></div><div><div className="text-lg font-semibold">Relay CRM</div><div className="text-xs text-muted-foreground">Account recovery</div></div></div><h1 className="text-xl font-semibold">Forgot your password?</h1><p className="mt-1 text-sm leading-relaxed text-muted-foreground">Enter your work email and we’ll send a one-time reset link if it matches an account.</p>
    {!sent ? <form onSubmit={submit} className="mt-6 flex flex-col gap-4"><label className="flex flex-col gap-1.5 text-sm font-medium">Email<Input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>{error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p>}<Button type="submit" disabled={busy}>{busy ? "Sending…" : <><Mail data-icon="inline-start" />Send reset link</>}</Button></form> : <div role="status" className="mt-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm leading-relaxed text-emerald-900">If an account exists for that email, password reset instructions will arrive shortly.</div>}
    <Link href="/login" className="mt-6 inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />Back to sign in</Link></section></main>;
}
