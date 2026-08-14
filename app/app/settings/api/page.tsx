import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import Link from "next/link";
import { redirect } from "next/navigation";

import { authOptions } from "@/server/auth";
import { hasWorkspacePermission, resolveWorkspaceContext } from "@/lib/workspaces";
import { ApiKeyManager } from "./ApiKeyManager";

export const metadata: Metadata = {
  title: "API Documentation",
};

const scopes = [
  {
    name: "invoices:read",
    description: "List and read invoices in the active workspace.",
  },
  {
    name: "invoices:write",
    description: "Create, update, and delete invoices in the active workspace.",
  },
  {
    name: "clients:read",
    description: "List and read clients in the active workspace.",
  },
  {
    name: "clients:write",
    description: "Create, update, and delete clients in the active workspace.",
  },
];

export default async function ApiSettingsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    redirect("/auth/login");
  }

  const workspace = await resolveWorkspaceContext(session.user.id);

  return (
    <main className="relative mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 pb-24 pt-10">
      <header className="space-y-4">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">Pengaturan / API</p>
        <div className="max-w-3xl space-y-3">
          <h1 className="text-4xl font-semibold text-text">Dokumentasi API</h1>
          <p className="text-base text-text/65">
            Hubungkan workflow Anda ke InvoSmart dengan API v1. Semua resource dibatasi ke workspace yang memiliki API key.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <a
              href="/api/openapi.json"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-bg transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Unduh OpenAPI JSON ↗
            </a>
            <Link
              href="/app/help"
              className="inline-flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2 text-sm text-text/80 transition hover:border-white/20 hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              Pusat Bantuan
            </Link>
          </div>
        </div>
      </header>

      <section className="grid gap-5 lg:grid-cols-2">
        <article className="glass-surface space-y-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-text/45">Base URL</p>
            <code className="mt-2 block rounded-xl bg-black/20 px-4 py-3 text-sm text-accent">/api/v1</code>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-text/45">Authentication</p>
            <p className="mt-2 text-sm leading-relaxed text-text/70">
              Kirim API key sebagai bearer token pada setiap request:
            </p>
            <code className="mt-3 block overflow-x-auto rounded-xl bg-black/20 px-4 py-3 text-xs text-text/85">
              Authorization: Bearer inv_live_...
            </code>
          </div>
          <p className="text-xs leading-relaxed text-text/50">
            Secret API key hanya ditampilkan sekali saat dibuat. Jangan commit key ke source control atau mengirimkannya ke
            browser.
          </p>
        </article>

        <article className="glass-surface space-y-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-text/45">Safe retries</p>
            <h2 className="mt-2 text-xl font-semibold text-text">Idempotency untuk create</h2>
            <p className="mt-2 text-sm leading-relaxed text-text/70">
              Sertakan header <code className="text-accent">Idempotency-Key</code> pada create invoice dan client. Retry dengan
              key dan payload yang sama mengembalikan hasil awal; payload berbeda menghasilkan <code>409</code>.
            </p>
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-text/45">Pagination</p>
            <p className="mt-2 text-sm leading-relaxed text-text/70">
              Gunakan <code className="text-accent">limit</code> (maksimal 100) dan <code className="text-accent">cursor</code>{" "}
              dari <code className="text-accent">meta.nextCursor</code> untuk mengambil halaman berikutnya.
            </p>
          </div>
        </article>
      </section>

      <section className="space-y-4">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text/45">Permissions</p>
          <h2 className="mt-2 text-2xl font-semibold text-text">Scopes API</h2>
        </div>
        <div className="overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04]">
          <div className="divide-y divide-white/10">
            {scopes.map((scope) => (
              <div key={scope.name} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,220px)_1fr] sm:items-center">
                <code className="text-sm text-accent">{scope.name}</code>
                <p className="text-sm text-text/65">{scope.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ApiKeyManager
        organizationId={workspace?.organizationId ?? null}
        canManage={Boolean(workspace && hasWorkspacePermission(workspace.role, "manage_workspace"))}
      />

      <section className="glass-surface space-y-3 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
        <p className="text-xs uppercase tracking-[0.3em] text-text/45">Available resources</p>
        <div className="grid gap-3 text-sm text-text/75 sm:grid-cols-2">
          <code className="rounded-xl bg-black/20 px-4 py-3">GET /invoices</code>
          <code className="rounded-xl bg-black/20 px-4 py-3">POST /invoices</code>
          <code className="rounded-xl bg-black/20 px-4 py-3">GET/PATCH/DELETE /invoices/:id</code>
          <code className="rounded-xl bg-black/20 px-4 py-3">GET /clients</code>
          <code className="rounded-xl bg-black/20 px-4 py-3">POST /clients</code>
          <code className="rounded-xl bg-black/20 px-4 py-3">GET/PATCH/DELETE /clients/:id</code>
        </div>
      </section>

      <section className="glass-surface space-y-4 rounded-[24px] border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_20px_rgba(0,0,0,0.2)]">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-text/45">Quick start</p>
          <h2 className="mt-2 text-2xl font-semibold text-text">List invoices with cURL</h2>
        </div>
        <pre className="overflow-x-auto rounded-xl bg-black/20 p-4 text-xs leading-relaxed text-text/80">
          <code>{`curl https://your-invosmart-host/api/v1/invoices \\
  -H "Authorization: Bearer inv_live_..." \\
  -H "Accept: application/json"`}</code>
        </pre>
        <p className="text-sm leading-relaxed text-text/60">
          Baca <a className="text-accent underline" href="/api/openapi.json">OpenAPI JSON</a> untuk schema lengkap, status error,
          dan contoh parameter request.
        </p>
      </section>
    </main>
  );
}
