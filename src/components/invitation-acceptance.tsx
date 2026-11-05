"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function InvitationAcceptance({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [acceptedEmail, setAcceptedEmail] = useState("");
  const [busy, setBusy] = useState(false);

  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!token) { setError("This invitation link is incomplete. Ask your administrator to send a new one."); return; }
    if (password !== confirmPassword) { setError("The passwords do not match."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not accept invitation.");
      setAcceptedEmail(data.email);
      setPassword(""); setConfirmPassword("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not accept invitation."); }
    finally { setBusy(false); }
  }

  return <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4"><section className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-sm"><div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary text-sm font-semibold text-primary-foreground">R</div><h1 className="text-xl font-semibold">Accept your invitation</h1>{acceptedEmail ? <><p className="mt-2 text-sm text-muted-foreground">Your account for <span className="font-medium text-foreground">{acceptedEmail}</span> is ready. You can sign in now.</p><Button className="mt-6 w-full" onClick={() => { router.push("/login"); router.refresh(); }}>Continue to sign in</Button></> : <><p className="mt-2 text-sm text-muted-foreground">Choose a password to finish setting up your Relay CRM account.</p><form onSubmit={accept} className="mt-6 flex flex-col gap-4"><label className="flex flex-col gap-1.5 text-sm font-medium">Password<Input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 12 characters" /></label><label className="flex flex-col gap-1.5 text-sm font-medium">Confirm password<Input type="password" autoComplete="new-password" minLength={12} maxLength={1024} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>{error && <p role="alert" className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}<Button type="submit" className="w-full" disabled={busy}>{busy ? "Accepting…" : "Accept invitation"}</Button></form></>}{error && acceptedEmail && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}<Link href="/login" className="mt-5 inline-flex text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link></section></main>;
}
