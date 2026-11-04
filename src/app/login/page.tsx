"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LockKeyhole, MessageCircle, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const router = useRouter();
  const [setup, setSetup] = useState<boolean | null>(null);
  const [databaseConfigured, setDatabaseConfigured] = useState(false);
  const [bootstrapSecretRequired, setBootstrapSecretRequired] = useState(false);
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [setupPending, setSetupPending] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mfaStep, setMfaStep] = useState(false);
  const [mfaCode, setMfaCode] = useState("");

  useEffect(() => {
    fetch("/api/auth/status", { cache: "no-store" }).then((response) => response.json()).then((data) => {
      setSetup(data.hasOwner); setDatabaseConfigured(Boolean(data.databaseConfigured)); setBootstrapSecretRequired(Boolean(data.bootstrapSecretRequired));
      if (data.user) router.replace("/admin/numbers");
    }).catch(() => setError("Could not connect to the local CRM server."));
  }, [router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body = mfaStep ? { code: mfaCode } : setup ? { email, password } : databaseConfigured ? { name, email, bootstrapSecret } : { name, email, password };
      const response = await fetch(mfaStep ? "/api/auth/mfa/challenge" : setup ? "/api/auth/login" : "/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to continue.");
      if (data.verificationRequired) { setSetupPending(true); setError(""); return; }
      if (data.requiresMfa) { setMfaStep(true); setError(""); return; }
      router.push("/admin/numbers");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to continue.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="flex min-h-screen items-center justify-center bg-[#f6f8f6] px-4 py-10">
    <div className="w-full max-w-[420px] rounded-2xl border bg-white p-8 shadow-sm">
      <div className="mb-8 flex items-center gap-3"><div className="flex size-11 items-center justify-center rounded-xl bg-primary text-white"><MessageCircle className="size-5" /></div><div><div className="text-lg font-semibold">Relay CRM</div><div className="text-xs text-muted-foreground">Secure workspace access</div></div></div>
      <div className="mb-6"><div className="text-xl font-semibold">{setupPending ? "Check your inbox" : mfaStep ? "Verify your identity" : setup ? "Welcome back" : "Create your owner account"}</div><p className="mt-1 text-sm text-muted-foreground">{setupPending ? `We sent a one-time owner verification link to ${email}. Open it to verify your address and finish account setup.` : mfaStep ? "Enter a code from your authenticator app or one of your recovery codes." : setup ? "Sign in to manage your inbox and connected numbers." : databaseConfigured ? "Verify your email before the workspace owner account is activated." : "This first account will have workspace owner access."}</p></div>
      {!setupPending && <form onSubmit={submit} className="flex flex-col gap-4">
        {!mfaStep && !setup && <label className="flex flex-col gap-1.5 text-sm font-medium">Full name<Input autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /></label>}
        {!mfaStep && <label className="flex flex-col gap-1.5 text-sm font-medium">Email<Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" /></label>}
        {!mfaStep && (setup || !databaseConfigured) && <label className="flex flex-col gap-1.5 text-sm font-medium">Password<Input type="password" autoComplete={setup ? "current-password" : "new-password"} minLength={12} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder={setup ? "Your password" : "At least 12 characters"} /></label>}
        {!mfaStep && !setup && bootstrapSecretRequired && <label className="flex flex-col gap-1.5 text-sm font-medium">Owner setup secret<Input type="password" autoComplete="off" required value={bootstrapSecret} onChange={(event) => setBootstrapSecret(event.target.value)} placeholder="Provided by your system administrator" /></label>}
        {mfaStep && <label className="flex flex-col gap-1.5 text-sm font-medium">Authenticator or recovery code<Input autoComplete="one-time-code" inputMode="numeric" autoFocus required maxLength={32} value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} placeholder="6-digit code" /></label>}
        {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
        <Button type="submit" disabled={busy || setup === null} className="mt-1 w-full">{busy ? "Please wait…" : mfaStep ? "Verify and sign in" : setup ? "Sign in" : databaseConfigured ? "Send verification link" : "Create owner account"}</Button>
        {mfaStep && <Button type="button" className="text-xs font-medium text-primary hover:underline" onClick={async () => { await fetch("/api/auth/logout", { method: "POST" }); setMfaStep(false); setMfaCode(""); }} variant="ghost">Cancel and sign in again</Button>}
        {setup && <div className="text-center"><Link href="/login/forgot-password" className="text-xs font-medium text-primary hover:underline">Forgot password?</Link></div>}
      </form>}
      {setupPending && <Button type="button" variant="outline" className="w-full" onClick={() => { setSetupPending(false); setBootstrapSecret(""); }}>Use a different email</Button>}
      <div className="mt-6 flex items-start gap-2 rounded-lg bg-[#f6f8f6] p-3 text-xs leading-relaxed text-muted-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span>Admin access is protected by a signed session. Enable MFA before connecting production messaging numbers.</span></div>
      <p className="mt-5 flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><LockKeyhole className="size-3" />Passwords are protected with a unique salted hash.</p>
    </div>
  </main>;
}
