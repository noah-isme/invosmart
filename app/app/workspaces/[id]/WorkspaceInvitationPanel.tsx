"use client";

import { FormEvent, useEffect, useState } from "react";

type Invitation = {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
};

export function WorkspaceInvitationPanel({ organizationId }: { organizationId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("MEMBER");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [tokenLink, setTokenLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/workspaces/${organizationId}/invitations`)
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { data?: Invitation[] };
        if (!cancelled) setInvitations(body.data ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  const load = async () => {
    const response = await fetch(`/api/workspaces/${organizationId}/invitations`);
    if (!response.ok) return;
    const body = await response.json() as { data?: Invitation[] };
    setInvitations(body.data ?? []);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setTokenLink(null);
    const response = await fetch(`/api/workspaces/${organizationId}/invitations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string; token?: string };
    if (!response.ok) {
      setMessage(body.error || "Unable to create invitation");
      return;
    }
    setEmail("");
    setMessage("Invitation created. Copy the link below and send it to the teammate.");
    if (body.token) {
      setTokenLink(`${window.location.origin}/app/workspace-invitations/accept?token=${encodeURIComponent(body.token)}`);
    }
    await load();
  };

  return (
    <section className="mt-6 rounded-2xl border border-white/10 bg-black/10 p-5">
      <h3 className="text-lg font-medium text-white">Invite a teammate</h3>
      <form onSubmit={submit} className="mt-4 flex flex-col gap-3 md:flex-row md:items-end">
        <label className="flex flex-1 flex-col gap-1 text-xs text-white/60">
          Email
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required className="rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white" />
        </label>
        <label className="flex flex-col gap-1 text-xs text-white/60">
          Role
          <select value={role} onChange={(event) => setRole(event.target.value)} className="rounded-lg border border-white/15 bg-slate-900 px-3 py-2 text-sm text-white">
            <option value="MEMBER">Member</option>
            <option value="VIEWER">Viewer</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-400">Create invite</button>
      </form>
      {message ? <p className="mt-3 text-sm text-white/70">{message}</p> : null}
      {tokenLink ? <p className="mt-2 break-all rounded-lg bg-white/5 p-3 text-xs text-indigo-200">{tokenLink}</p> : null}
      <ul className="mt-5 divide-y divide-white/10">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
            <span className="text-white/80">{invitation.email}</span>
            <span className="text-xs text-white/50">{invitation.role} · {invitation.acceptedAt ? "Accepted" : invitation.revokedAt ? "Revoked" : "Pending"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
