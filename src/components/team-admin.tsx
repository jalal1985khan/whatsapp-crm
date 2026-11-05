"use client";

import { CheckboxControl } from "@/components/ui/checkbox-control";

import { SelectControl } from "@/components/ui/select-control";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, ShieldCheck, UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type TeamMember = { id: string; name: string; email: string; role: string; active?: boolean };
type TeamRecord = { id: string; name: string; members: { id: string; name: string; email: string; role: string }[] };

export function TeamAdmin({ initialTeam, currentUserId }: { initialTeam: TeamMember[]; currentUserId: string }) {
  const router = useRouter();
  const [team, setTeam] = useState(initialTeam);
  const [groups, setGroups] = useState<TeamRecord[]>([]);
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [editingGroupId, setEditingGroupId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("Agent");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryTarget, setRecoveryTarget] = useState<TeamMember | null>(null);
  const [recoveryReason, setRecoveryReason] = useState("");
  const [identityVerified, setIdentityVerified] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([fetch("/api/team", { cache: "no-store" }), fetch("/api/teams", { cache: "no-store" })]).then(async ([membersResponse, groupsResponse]) => {
      const membersData = await membersResponse.json(); const groupsData = await groupsResponse.json();
      if (!cancelled && Array.isArray(membersData.team)) setTeam(membersData.team);
      if (!cancelled && Array.isArray(groupsData.teams)) setGroups(groupsData.teams);
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  async function addMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not send team invitation.");
      setName(""); setEmail("");
      setNotice(`Invitation sent to ${data.invitation.email}. The link expires in 48 hours; the member will set their own password.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not send team invitation."); }
    finally { setBusy(false); }
  }

  async function updateMember(member: TeamMember, action: "change_role" | "activate" | "deactivate", nextRole?: string) {
    if (action === "deactivate" && !window.confirm(`Deactivate ${member.name}? Their active CRM sessions will be revoked immediately.`)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: member.id, action, ...(nextRole ? { role: nextRole } : {}) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not update team access.");
      setTeam((current) => current.map((item) => item.id === member.id ? data.member : item));
      setNotice(action === "change_role" ? `${member.name}'s role updated. Their active sessions were revoked.` : action === "deactivate" ? `${member.name} was deactivated and signed out.` : `${member.name} was reactivated.`);
      if (member.id === currentUserId && action !== "activate") router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update team access."); }
    finally { setBusy(false); }
  }

  async function recoverMfa(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recoveryTarget || !identityVerified) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/team", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: recoveryTarget.id, action: "recover_mfa", reason: recoveryReason, identityVerified }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not recover this account’s MFA.");
      setRecoveryTarget(null); setRecoveryReason(""); setIdentityVerified(false);
      setNotice(data.member.noticeSent ? `${data.member.name}’s MFA was reset, their active sign-ins were revoked, and a security notice was emailed. They must enroll a new authenticator before protected admin changes.` : `${data.member.name}’s MFA was reset and their active sign-ins were revoked. Email could not be confirmed as sent; contact them through your trusted channel. They must enroll a new authenticator before protected admin changes.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not recover this account’s MFA."); }
    finally { setBusy(false); }
  }

  async function saveGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/teams", { method: editingGroupId ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...(editingGroupId ? { id: editingGroupId } : {}), name: groupName, memberIds: groupMembers }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not save team.");
      setGroups((current) => editingGroupId ? current.map((group) => group.id === data.team.id ? data.team : group) : [...current, data.team].sort((a, b) => a.name.localeCompare(b.name)));
      setGroupName(""); setGroupMembers([]); setEditingGroupId(""); setNotice("Team saved and audited.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save team."); }
    finally { setBusy(false); }
  }

  async function deleteGroup(group: TeamRecord) {
    if (!window.confirm(`Delete team ${group.name}? It must not be referenced by routing or conversations.`)) return;
    setBusy(true); setError(""); setNotice("");
    try { const response = await fetch(`/api/teams?id=${encodeURIComponent(group.id)}`, { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Could not delete team."); setGroups((current) => current.filter((item) => item.id !== group.id)); setNotice("Team deleted and audited."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete team."); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-8">
      <div className="mb-7 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team members</h1>
          <p className="mt-1 text-sm text-muted-foreground">Add people who can sign in and work on customer conversations.</p>
        </div>
        <Badge variant="secondary">{team.length} members</Badge>
      </div>
      {notice && <div role="status" className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}{error && <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      <section className="mb-5 rounded-2xl border bg-white shadow-sm"><div className="px-5 py-4"><h2 className="text-sm font-semibold">Teams</h2><p className="mt-1 text-xs text-muted-foreground">Create workspace teams for conversation assignment and number/routing policies.</p></div><Separator /><div className="divide-y">{groups.map((group) => <div key={group.id} className="flex flex-wrap items-center gap-3 px-5 py-3"><div className="min-w-[160px] flex-1"><p className="text-sm font-medium">{group.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{group.members.length ? group.members.map((member) => member.name).join(", ") : "No active members"}</p></div><Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setEditingGroupId(group.id); setGroupName(group.name); setGroupMembers(group.members.map((member) => member.id)); }}>Edit</Button><Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void deleteGroup(group)}>Delete</Button></div>)}{!groups.length && <p className="px-5 py-4 text-xs text-muted-foreground">No teams created yet.</p>}</div><Separator /><form onSubmit={saveGroup} className="grid gap-3 p-5"><div className="flex flex-wrap items-end gap-3"><label className="min-w-[220px] flex-1 space-y-1.5 text-xs font-medium">{editingGroupId ? "Edit team name" : "New team name"}<Input required maxLength={80} value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Customer support" /></label><Button type="submit" disabled={busy}>{editingGroupId ? "Save team" : "Create team"}</Button>{editingGroupId && <Button type="button" variant="outline" disabled={busy} onClick={() => { setEditingGroupId(""); setGroupName(""); setGroupMembers([]); }}>Cancel</Button>}</div><fieldset className="space-y-2"><legend className="text-xs font-medium">Active members</legend><div className="flex flex-wrap gap-2">{team.filter((member) => member.active !== false).map((member) => <label key={member.id} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs"><CheckboxControl aria-label={`Include ${member.name} in this team`} checked={groupMembers.includes(member.id)} onChange={(event) => setGroupMembers((current) => event.target.checked ? [...current, member.id] : current.filter((id) => id !== member.id))} />{member.name}</label>)}</div></fieldset></form></section>
      <section className="rounded-2xl border bg-white shadow-sm"><div className="px-5 py-4"><h2 className="text-sm font-semibold">Workspace access</h2><p className="mt-1 text-xs text-muted-foreground">Admins can update roles, recover MFA after a separate identity check, and deactivate accounts. Changes are audited and active sessions are revoked.</p></div><Separator /><div className="divide-y">{team.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-4"><Avatar className="size-10"><AvatarFallback className="bg-primary/10 text-xs text-primary">{member.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</AvatarFallback></Avatar><div className="min-w-[180px] flex-1"><div className="text-sm font-medium">{member.name}{member.id === currentUserId && <span className="ml-2 text-[10px] text-muted-foreground">You</span>}</div><div className="text-xs text-muted-foreground">{member.email}</div></div><Badge variant={member.active === false ? "warning" : member.role === "Owner" ? "default" : "outline"}>{member.active === false ? "Inactive" : member.role}</Badge>{member.role !== "Owner" && <><SelectControl aria-label={`Role for ${member.name}`} value={member.role} disabled={busy || member.active === false} onChange={(event) => void updateMember(member, "change_role", event.target.value)} className="h-9 rounded-md border bg-white px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"><option>Agent</option><option>Supervisor</option><option>Admin</option></SelectControl>{member.active === false ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void updateMember(member, "activate")}>Reactivate</Button> : <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void updateMember(member, "deactivate")}>Deactivate</Button>}</>}{member.id !== currentUserId && member.active !== false && <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setRecoveryTarget(member); setRecoveryReason(""); setIdentityVerified(false); }}>Recover MFA</Button>}</div>)}</div></section>
      <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2"><div className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><UserPlus className="size-4" /></div><div><h2 className="text-sm font-semibold">Invite team member</h2><p className="text-xs text-muted-foreground">We’ll email a one-time link so they can confirm their address and set their password. Requires PostgreSQL and configured Resend email.</p></div></div>
        <form onSubmit={addMember} className="grid gap-3 md:grid-cols-2"><label className="flex flex-col gap-1.5 text-xs font-medium">Full name<Input required maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Team member name" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Email<Input type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@company.com" /></label><label className="flex flex-col gap-1.5 text-xs font-medium">Role<SelectControl value={role} onChange={(event) => setRole(event.target.value)} className="h-10 rounded-lg border bg-white px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"><option>Agent</option><option>Supervisor</option><option>Admin</option></SelectControl></label><div className="flex items-center gap-2"><Button type="submit" disabled={busy}><Plus data-icon="inline-start" />{busy ? "Sending…" : "Send invitation"}</Button><span className="flex items-center gap-1 text-[10px] text-muted-foreground"><ShieldCheck className="size-3" />One-time link expires in 48 hours.</span></div></form>
      </section>
      <Dialog open={Boolean(recoveryTarget)} onOpenChange={(open) => { if (!open && !busy) { setRecoveryTarget(null); setRecoveryReason(""); setIdentityVerified(false); } }}><DialogContent><DialogHeader><DialogTitle>Recover MFA for {recoveryTarget?.name}</DialogTitle><DialogDescription>This resets their authenticator and signs out all active sessions. They can sign in with their password, but must enroll a new authenticator before making protected administrator changes. Verify their identity through a separate trusted channel before continuing.</DialogDescription></DialogHeader><form onSubmit={recoverMfa} className="flex flex-col gap-4"><label className="flex flex-col gap-1.5 text-sm font-medium">Identity verification record<Textarea maxLength={500} minLength={20} value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} placeholder="Record how you verified this member’s identity. Do not include passwords or authentication codes." /></label><label className="flex items-start gap-2 text-xs leading-relaxed"><CheckboxControl aria-label="Confirm identity verification" checked={identityVerified} onChange={(event) => setIdentityVerified(event.target.checked)} /><span>I verified this member’s identity through a separate trusted channel.</span></label><DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setRecoveryTarget(null)}>Cancel</Button><Button type="submit" variant="destructive" disabled={busy || !identityVerified || recoveryReason.trim().length < 20}>{busy ? "Recovering…" : "Reset MFA and revoke sessions"}</Button></DialogFooter></form></DialogContent></Dialog>
    </div>
  );
}
