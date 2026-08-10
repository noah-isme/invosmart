import Link from "next/link";
import { db } from "@/lib/db";

type AuditLogPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const resolveSearchParams = async (searchParams: AuditLogPageProps["searchParams"]) =>
  (await searchParams) ?? {};

const formatDateTime = (value: Date | string) =>
  new Date(value).toLocaleString("id-ID", { hour12: false });

export default async function AuditLogsPage({ searchParams }: AuditLogPageProps) {
  const resolved = await resolveSearchParams(searchParams);

  const action = typeof resolved.action === "string" ? resolved.action : undefined;
  const entity = typeof resolved.entity === "string" ? resolved.entity : undefined;
  const userId = typeof resolved.userId === "string" ? resolved.userId : undefined;
  const tenantId = typeof resolved.tenantId === "string" ? resolved.tenantId : undefined;
  const page = typeof resolved.page === "string" ? Math.max(parseInt(resolved.page, 10) || 1, 1) : 1;

  const limit = 25;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;
  if (tenantId) where.tenantId = tenantId;

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    }),
    db.auditLog.count({ where }),
  ]);

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <h2 className="mb-4 text-base font-semibold text-white">Filter Audit Logs</h2>
        <form method="GET" className="grid gap-4 md:grid-cols-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Aksi (Action)</label>
            <input
              type="text"
              name="action"
              defaultValue={action ?? ""}
              placeholder="e.g. INVOICE_CREATE"
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Entitas (Entity)</label>
            <input
              type="text"
              name="entity"
              defaultValue={entity ?? ""}
              placeholder="e.g. Invoice"
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">User ID</label>
            <input
              type="text"
              name="userId"
              defaultValue={userId ?? ""}
              placeholder="e.g. usr_123"
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-white/70">Tenant ID</label>
            <input
              type="text"
              name="tenantId"
              defaultValue={tenantId ?? ""}
              placeholder="e.g. tenant_abc"
              className="w-full rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 focus:border-indigo-400 focus:outline-none"
            />
          </div>
          <div className="md:col-span-4 flex justify-end gap-2">
            <Link
              href="/app/admin/audit-logs"
              className="rounded-lg border border-white/10 px-4 py-2 text-xs font-medium text-white/70 hover:bg-white/10"
            >
              Reset Filter
            </Link>
            <button
              type="submit"
              className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-medium text-white hover:bg-indigo-500"
            >
              Terapkan Filter
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5">
        <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-white">System Audit Logs</h1>
            <p className="text-xs text-white/60">
              Menampilkan {logs.length} dari {total} log audit.
            </p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-white/80">
            <thead className="bg-white/10 text-xs uppercase text-white/60">
              <tr>
                <th className="px-6 py-3">Waktu</th>
                <th className="px-6 py-3">Aksi</th>
                <th className="px-6 py-3">Entitas</th>
                <th className="px-6 py-3">Entity ID</th>
                <th className="px-6 py-3">User / Actor</th>
                <th className="px-6 py-3">IP Address</th>
                <th className="px-6 py-3">Detail Metadata</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-white/50">
                    Tidak ada log audit yang ditemukan.
                  </td>
                </tr>
              ) : (
                logs.map((log) => (
                  <tr key={log.id} className="border-t border-white/10">
                    <td className="px-6 py-3 whitespace-nowrap">{formatDateTime(log.createdAt)}</td>
                    <td className="px-6 py-3">
                      <span className="rounded bg-indigo-500/20 px-2 py-1 text-xs font-mono text-indigo-300">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-6 py-3">{log.entity}</td>
                    <td className="px-6 py-3 font-mono text-xs text-white/60">{log.entityId ?? "–"}</td>
                    <td className="px-6 py-3">
                      {log.user ? (
                        <div>
                          <div className="font-medium text-white">{log.user.name ?? "User"}</div>
                          <div className="text-xs text-white/50">{log.user.email}</div>
                        </div>
                      ) : (
                        <span className="text-xs text-white/50">{log.userId ?? "System/Guest"}</span>
                      )}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-white/60">{log.ipAddress ?? "–"}</td>
                    <td className="px-6 py-3 max-w-[280px]">
                      {log.details ? (
                        <details className="cursor-pointer text-xs">
                          <summary className="text-indigo-300 hover:underline">Lihat JSON</summary>
                          <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/40 p-2 font-mono text-[10px] text-white/80">
                            {JSON.stringify(log.details, null, 2)}
                          </pre>
                        </details>
                      ) : (
                        <span className="text-xs text-white/40">–</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center justify-between border-t border-white/10 px-6 py-4 text-xs text-white/70">
          <div>
            Halaman {page} dari {totalPages} ({total} total logs)
          </div>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                href={`/app/admin/audit-logs?page=${page - 1}${action ? `&action=${action}` : ""}${entity ? `&entity=${entity}` : ""}`}
                className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/10"
              >
                ← Sebelumnya
              </Link>
            )}
            {page < totalPages && (
              <Link
                href={`/app/admin/audit-logs?page=${page + 1}${action ? `&action=${action}` : ""}${entity ? `&entity=${entity}` : ""}`}
                className="rounded-lg border border-white/10 px-3 py-1.5 hover:bg-white/10"
              >
                Selanjutnya →
              </Link>
            )}
          </div>
        </footer>
      </section>
    </div>
  );
}
