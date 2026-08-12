"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Flag, Plus, RefreshCw, Trash2, UserCheck, Building } from "lucide-react";

type FeatureFlagItem = {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  enabled: boolean;
  targetTenants?: unknown;
  targetUsers?: unknown;
  createdAt: string;
  updatedAt: string;
};

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureFlagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Form State for Create / Edit
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [nameInput, setNameInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const [enabledInput, setEnabledInput] = useState(true);
  const [targetTenantsInput, setTargetTenantsInput] = useState("");
  const [targetUsersInput, setTargetUsersInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchFlags = async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await fetch("/api/admin/feature-flags");
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal memuat feature flags`);
      }
      const json = await res.json();
      setFlags(json.data || json.flags || []);
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Gagal memuat daftar feature flags.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFlags();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setKeyInput("");
    setNameInput("");
    setDescriptionInput("");
    setEnabledInput(true);
    setTargetTenantsInput("");
    setTargetUsersInput("");
    setIsModalOpen(true);
  };

  const openEditModal = (flag: FeatureFlagItem) => {
    setEditingId(flag.id);
    setKeyInput(flag.key);
    setNameInput(flag.name);
    setDescriptionInput(flag.description || "");
    setEnabledInput(flag.enabled);
    
    let tenantsStr = "";
    if (Array.isArray(flag.targetTenants)) {
      tenantsStr = flag.targetTenants.join(", ");
    } else if (typeof flag.targetTenants === "string") {
      tenantsStr = flag.targetTenants;
    }
    setTargetTenantsInput(tenantsStr);

    let usersStr = "";
    if (Array.isArray(flag.targetUsers)) {
      usersStr = flag.targetUsers.join(", ");
    } else if (typeof flag.targetUsers === "string") {
      usersStr = flag.targetUsers;
    }
    setTargetUsersInput(usersStr);

    setIsModalOpen(true);
  };

  const handleToggle = async (flag: FeatureFlagItem) => {
    try {
      setErrorMessage(null);
      const updatedEnabled = !flag.enabled;
      
      // Optimistic update
      setFlags((prev) =>
        prev.map((f) => (f.id === flag.id ? { ...f, enabled: updatedEnabled } : f))
      );

      const res = await fetch("/api/admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: flag.id, enabled: updatedEnabled }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal memperbarui status flag`);
      }

      setSuccessMessage(`Flag "${flag.name}" berhasil di-${updatedEnabled ? "aktifkan" : "nonaktifkan"}.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchFlags();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Gagal memperbarui toggle flag.");
      fetchFlags();
    }
  };

  const handleDelete = async (flag: FeatureFlagItem) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus flag "${flag.name}"?`)) {
      return;
    }

    try {
      setErrorMessage(null);
      const res = await fetch(`/api/admin/feature-flags?id=${flag.id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: Gagal menghapus flag`);
      }

      setSuccessMessage(`Flag "${flag.name}" berhasil dihapus.`);
      setTimeout(() => setSuccessMessage(null), 3000);
      fetchFlags();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Gagal menghapus flag.");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyInput.trim() || !nameInput.trim()) {
      setErrorMessage("Key dan Name wajib diisi.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const parsedTenants = targetTenantsInput.trim()
        ? targetTenantsInput.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

      const parsedUsers = targetUsersInput.trim()
        ? targetUsersInput.split(",").map((s) => s.trim()).filter(Boolean)
        : null;

      const payload = {
        ...(editingId ? { id: editingId } : {}),
        key: keyInput.trim(),
        name: nameInput.trim(),
        description: descriptionInput.trim() || null,
        enabled: enabledInput,
        targetTenants: parsedTenants,
        targetUsers: parsedUsers,
      };

      const res = await fetch("/api/admin/feature-flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.error || `HTTP ${res.status}: Gagal menyimpan feature flag`);
      }

      setSuccessMessage(editingId ? "Feature flag berhasil diperbarui." : "Feature flag baru berhasil dibuat.");
      setTimeout(() => setSuccessMessage(null), 3000);
      setIsModalOpen(false);
      fetchFlags();
    } catch (err: unknown) {
      setErrorMessage((err as Error).message || "Gagal menyimpan feature flag.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatScopeList = (scope: unknown) => {
    if (!scope) return <span className="text-white/40 italic">Global</span>;
    let list: string[] = [];
    if (Array.isArray(scope)) {
      list = scope;
    } else if (typeof scope === "string") {
      try {
        list = JSON.parse(scope);
      } catch {
        list = [scope];
      }
    }

    if (list.length === 0) return <span className="text-white/40 italic">Global</span>;

    return (
      <div className="flex flex-wrap gap-1">
        {list.map((item, idx) => (
          <span
            key={idx}
            className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-mono text-indigo-300 border border-white/10"
          >
            {item}
          </span>
        ))}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-6 text-white">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm text-indigo-300">
            <Link href="/app/admin" className="hover:underline">
              Admin
            </Link>
            <span>/</span>
            <span>Feature Flags</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2 mt-1">
            <Flag className="h-7 w-7 text-indigo-400" />
            Runtime Feature Flags
          </h1>
          <p className="text-sm text-white/70">
            Kelola toggle fitur runtime tanpa redeploy, mendukung kontrol scope per-tenant dan per-user.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchFlags}
            disabled={loading}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={openCreateModal}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white shadow-lg transition hover:bg-indigo-500"
          >
            <Plus className="h-4 w-4" />
            Tambah Flag Baru
          </button>
        </div>
      </div>

      {/* Notifications */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm text-rose-300 flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300 flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-400 shrink-0" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Table */}
      <section className="rounded-2xl border border-white/10 bg-white/5 shadow-xl backdrop-blur-md overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm text-white/80">
            <thead className="bg-white/10 text-xs uppercase text-white/60">
              <tr>
                <th className="px-6 py-3">Flag Key & Name</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Target Tenants</th>
                <th className="px-6 py-3">Target Users</th>
                <th className="px-6 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-white/50">
                    Memuat feature flags...
                  </td>
                </tr>
              ) : flags.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-white/50">
                    Belum ada feature flag terdaftar.
                  </td>
                </tr>
              ) : (
                flags.map((flag) => (
                  <tr key={flag.id} className="border-t border-white/10 hover:bg-white/5 transition">
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="font-semibold text-white">{flag.name}</span>
                        <span className="font-mono text-xs text-indigo-300">{flag.key}</span>
                        {flag.description && (
                          <span className="text-xs text-white/60 mt-1 max-w-md">{flag.description}</span>
                        )}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <button
                        onClick={() => handleToggle(flag)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                          flag.enabled ? "bg-emerald-500" : "bg-gray-600"
                        }`}
                        title={flag.enabled ? "Nonaktifkan Flag" : "Aktifkan Flag"}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                            flag.enabled ? "translate-x-6" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <Building className="h-3.5 w-3.5 text-white/40 shrink-0" />
                        {formatScopeList(flag.targetTenants)}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-1.5">
                        <UserCheck className="h-3.5 w-3.5 text-white/40 shrink-0" />
                        {formatScopeList(flag.targetUsers)}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => openEditModal(flag)}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white hover:bg-white/10 transition"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(flag)}
                          className="rounded-lg border border-rose-500/20 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition"
                          title="Hapus Flag"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Modal Form */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-gray-900 p-6 shadow-2xl">
            <h2 className="text-xl font-bold text-white mb-4">
              {editingId ? "Edit Feature Flag" : "Tambah Feature Flag Baru"}
            </h2>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Flag Key (Unique ID)*
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. bayesian_ab_overlay"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Nama Flag*
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Bayesian A/B Overlay"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Deskripsi
                </label>
                <textarea
                  rows={2}
                  placeholder="Penjelasan fungsi flag..."
                  value={descriptionInput}
                  onChange={(e) => setDescriptionInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="flagEnabled"
                  checked={enabledInput}
                  onChange={(e) => setEnabledInput(e.target.checked)}
                  className="h-4 w-4 rounded border-white/10 bg-white/5 text-indigo-600 focus:ring-indigo-500"
                />
                <label htmlFor="flagEnabled" className="text-sm font-medium text-white">
                  Aktifkan Secara Global (Enabled)
                </label>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Target Tenants (Opsional - Pisahkan koma)
                </label>
                <input
                  type="text"
                  placeholder="e.g. tenant-1, tenant-2"
                  value={targetTenantsInput}
                  onChange={(e) => setTargetTenantsInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Jika diisi, flag akan aktif untuk tenant terdaftar meskipun status global disabled.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-white/70 mb-1">
                  Target Users (Opsional - Pisahkan koma)
                </label>
                <input
                  type="text"
                  placeholder="e.g. user-101, user-102"
                  value={targetUsersInput}
                  onChange={(e) => setTargetUsersInput(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white font-mono placeholder:text-white/30 focus:border-indigo-500 focus:outline-none"
                />
                <p className="text-[11px] text-white/40 mt-1">
                  Jika diisi, flag akan aktif untuk user terdaftar meskipun status global disabled.
                </p>
              </div>

              <div className="flex items-center justify-end gap-3 mt-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 transition disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : "Simpan Flag"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
