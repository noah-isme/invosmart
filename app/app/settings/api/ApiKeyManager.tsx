"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type ApiKeyRecord = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
};

const scopes = [
  ["invoices:read", "Read invoices"],
  ["invoices:write", "Create, update, and delete invoices"],
  ["clients:read", "Read clients"],
  ["clients:write", "Create, update, and delete clients"],
] as const;

export function ApiKeyManager({
  organizationId,
  canManage,
}: {
  organizationId: string | null;
  canManage: boolean;
}) {
  const [keys, setKeys] = useState<ApiKeyRecord[]>([]);
  const [name, setName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["invoices:read", "clients:read"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadKeys = useCallback(async () => {
    if (!organizationId || !canManage) return;
    const response = await fetch(`/api/workspaces/${organizationId}/api-keys`, { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { data?: ApiKeyRecord[] };
    setKeys(body.data ?? []);
  }, [canManage, organizationId]);

  useEffect(() => {
    void loadKeys();
  }, [loadKeys]);

  const toggleScope = (scope: string) => {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  };

  const createKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!organizationId || !name.trim() || selectedScopes.length === 0) return;
    setBusy(true);
    setMessage(null);
    setToken(null);
    try {
      const response = await fetch(`/api/workspaces/${organizationId}/api-keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          scopes: selectedScopes,
          expiresAt: expiresAt ? new Date(`${expiresAt}T23:59:59.999Z`).toISOString() : null,
        }),
      });
      const body = (await response.json()) as { token?: string; error?: string };
      if (!response.ok) {
        setMessage(typeof body.error === "string" ? body.error : "Unable to create API key.");
        return;
      }
      setToken(body.token ?? null);
      setName("");
      setExpiresAt("");
      await loadKeys();
    } finally {
      setBusy(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    if (!organizationId || !window.confirm("Revoke this API key? Existing integrations will stop working.")) return;
    setBusy(true);
    try {
      await fetch(`/api/workspaces/${organizationId}/api-keys/${keyId}`, { method: "DELETE" });
      await loadKeys();
    } finally {
      setBusy(false);
    }
  };

  if (!organizationId) {
    return <p className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-sm text-amber-100">Pilih workspace aktif sebelum membuat API key.</p>;
  }

  if (!canManage) {
    return <p className="rounded-xl border border-white/10 bg-white/[0.04] p-4 text-sm text-text/65">Hanya OWNER atau ADMIN yang dapat mengelola API key workspace.</p>;
  }

  return (
    <section className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-[0.3em] text-text/45">Workspace credentials</p>
        <h2 className="mt-2 text-2xl font-semibold text-text">Kelola API key</h2>
        <p className="mt-2 text-sm text-text/65">Secret ditampilkan satu kali. Simpan di secret manager dan jangan kirim ke browser.</p>
      </div>

      <form onSubmit={createKey} className="glass-surface space-y-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6">
        <label className="block text-sm text-text/75">
          Nama key
          <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-text outline-none focus:border-primary" placeholder="Billing automation" />
        </label>
        <fieldset className="space-y-2">
          <legend className="text-sm text-text/75">Scopes</legend>
          {scopes.map(([scope, description]) => (
            <label key={scope} className="flex items-start gap-3 text-sm text-text/70">
              <input type="checkbox" checked={selectedScopes.includes(scope)} onChange={() => toggleScope(scope)} className="mt-1" />
              <span><code className="text-accent">{scope}</code><span className="ml-2 text-text/50">{description}</span></span>
            </label>
          ))}
        </fieldset>
        <label className="block text-sm text-text/75">
          Expiry (optional)
          <input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} className="mt-2 block rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-text" />
        </label>
        <button disabled={busy || !name.trim() || selectedScopes.length === 0} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-bg disabled:cursor-not-allowed disabled:opacity-50">{busy ? "Membuat…" : "Buat API key"}</button>
      </form>

      {token ? (
        <div className="rounded-xl border border-emerald-300/25 bg-emerald-300/10 p-4 text-sm text-emerald-100">
          <p className="font-medium">Salin secret ini sekarang — tidak akan ditampilkan lagi.</p>
          <code className="mt-3 block break-all rounded-lg bg-black/20 p-3 text-xs">{token}</code>
        </div>
      ) : null}
      {message ? <p className="text-sm text-rose-200">{message}</p> : null}

      <div className="space-y-3">
        {keys.map((key) => (
          <article key={key.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div>
              <p className="font-medium text-text">{key.name}</p>
              <p className="mt-1 text-xs text-text/50"><code>{key.prefix}_…</code> · {key.scopes.join(", ")}</p>
              <p className="mt-1 text-xs text-text/45">{key.revokedAt ? "Revoked" : key.expiresAt ? `Expires ${new Date(key.expiresAt).toLocaleDateString()}` : "No expiry"}</p>
            </div>
            {!key.revokedAt ? <button type="button" disabled={busy} onClick={() => void revokeKey(key.id)} className="rounded-lg border border-rose-300/25 px-3 py-2 text-xs text-rose-200 hover:border-rose-300/50 disabled:opacity-50">Revoke</button> : <span className="text-xs text-text/45">Revoked</span>}
          </article>
        ))}
        {keys.length === 0 ? <p className="text-sm text-text/50">Belum ada API key untuk workspace ini.</p> : null}
      </div>
    </section>
  );
}
