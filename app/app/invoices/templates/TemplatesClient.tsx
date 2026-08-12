"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatCurrency } from "@/lib/currency";
import { FileText, Copy, Trash2, Edit3, Plus, Search, Check, X, Loader2 } from "lucide-react";

export type InvoiceTemplateItem = {
  name: string;
  qty: number;
  price: number;
};

export type InvoiceTemplateRow = {
  id: string;
  name: string;
  client: string;
  items: unknown;
  subtotal: number;
  tax: number;
  total: number;
  currency: string;
  notes: string | null;
  clientId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export default function TemplatesClient({ initialTemplates }: { initialTemplates: InvoiceTemplateRow[] }) {
  const router = useRouter();
  const [templates, setTemplates] = useState<InvoiceTemplateRow[]>(initialTemplates);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New Template Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newClientName, setNewClientName] = useState("");
  const [newItems, setNewItems] = useState<InvoiceTemplateItem[]>([{ name: "", qty: 1, price: 0 }]);
  const [newCurrency, setNewCurrency] = useState("IDR");
  const [newNotes, setNewNotes] = useState("");
  const [createLoading, setCreateLoading] = useState(false);

  const filteredTemplates = templates.filter(
    (t) =>
      t.name.toLowerCase().includes(search.toLowerCase()) ||
      t.client.toLowerCase().includes(search.toLowerCase())
  );

  const handleInstantiate = async (template: InvoiceTemplateRow) => {
    setLoadingId(template.id);
    setError(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`/api/invoices/templates/${template.id}/instantiate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Gagal membuat invoice dari template.");
      }

      const payload = await res.json();
      const newInvoice = payload.data;
      setSuccessMsg(`Invoice ${newInvoice.number} berhasil dibuat!`);
      router.push(`/app/invoices/${newInvoice.id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(msg);
    } finally {
      setLoadingId(null);
    }
  };

  const handleStartRename = (template: InvoiceTemplateRow) => {
    setEditingId(template.id);
    setEditingName(template.name);
  };

  const handleSaveRename = async (id: string) => {
    if (!editingName.trim()) return;
    setLoadingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/invoices/templates/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editingName.trim() }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Gagal mengubah nama template.");
      }

      const payload = await res.json();
      setTemplates((prev) =>
        prev.map((t) => (t.id === id ? { ...t, name: payload.data.name } : t))
      );
      setEditingId(null);
      setEditingName("");
      setSuccessMsg("Nama template berhasil diperbarui.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(msg);
    } finally {
      setLoadingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Apakah Anda yakin ingin menghapus template ini?")) return;
    setLoadingId(id);
    setError(null);

    try {
      const res = await fetch(`/api/invoices/templates/${id}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Gagal menghapus template.");
      }

      setTemplates((prev) => prev.filter((t) => t.id !== id));
      setSuccessMsg("Template berhasil dihapus.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(msg);
    } finally {
      setLoadingId(null);
    }
  };

  const handleCreateTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTemplateName.trim() || !newClientName.trim()) {
      setError("Nama template dan nama klien wajib diisi.");
      return;
    }

    const validItems = newItems.filter((i) => i.name.trim() !== "");
    if (validItems.length === 0) {
      setError("Minimal satu item invoice harus diisi.");
      return;
    }

    setCreateLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/invoices/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newTemplateName.trim(),
          client: newClientName.trim(),
          items: validItems,
          currency: newCurrency,
          notes: newNotes.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? "Gagal membuat template baru.");
      }

      const payload = await res.json();
      setTemplates((prev) => [payload.data, ...prev]);
      setShowCreateModal(false);
      setNewTemplateName("");
      setNewClientName("");
      setNewItems([{ name: "", qty: 1, price: 0 }]);
      setNewNotes("");
      setSuccessMsg("Template baru berhasil dibuat.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Terjadi kesalahan.";
      setError(msg);
    } finally {
      setCreateLoading(false);
    }
  };

  const addItemRow = () => {
    setNewItems((prev) => [...prev, { name: "", qty: 1, price: 0 }]);
  };

  const removeItemRow = (index: number) => {
    setNewItems((prev) => prev.filter((_, i) => i !== index));
  };

  const updateItemRow = (index: number, field: keyof InvoiceTemplateItem, value: string | number) => {
    setNewItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--foreground)]">
            Template Invoice
          </h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Kelola template invoice berulang untuk mempercepat pembuatan invoice baru.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Template Baru
        </button>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive flex justify-between items-center">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-xs hover:underline">
            Tutup
          </button>
        </div>
      )}

      {successMsg && (
        <div className="rounded-md border border-emerald-600/40 bg-emerald-500/10 p-3 text-sm text-emerald-400 flex justify-between items-center">
          <span>{successMsg}</span>
          <button onClick={() => setSuccessMsg(null)} className="text-xs hover:underline">
            Tutup
          </button>
        </div>
      )}

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-[var(--muted-foreground)]" />
        <input
          type="text"
          placeholder="Cari template..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] pl-9 pr-3 py-2 text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>

      {filteredTemplates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[var(--border)] py-12 text-center bg-[var(--card)]">
          <FileText className="h-12 w-12 text-[var(--muted-foreground)] opacity-50" />
          <h3 className="mt-4 text-lg font-semibold text-[var(--foreground)]">
            Belum ada template invoice
          </h3>
          <p className="mb-4 mt-2 text-sm text-[var(--muted-foreground)] max-w-md">
            {search
              ? "Tidak ada template yang cocok dengan pencarian."
              : "Buat template dari invoice yang ada atau tambah template baru secara manual."}
          </p>
          {!search && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Buat Template Pertama
            </button>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTemplates.map((template) => {
            const itemsList = Array.isArray(template.items)
              ? (template.items as InvoiceTemplateItem[])
              : [];
            const isLoading = loadingId === template.id;
            const isEditing = editingId === template.id;

            return (
              <div
                key={template.id}
                className="group relative flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-sm transition-all hover:border-primary/50 hover:shadow-md"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    {isEditing ? (
                      <div className="flex items-center gap-1 flex-1">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-full rounded border border-primary px-2 py-1 text-sm bg-background"
                          autoFocus
                        />
                        <button
                          onClick={() => handleSaveRename(template.id)}
                          disabled={isLoading}
                          className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded"
                          title="Simpan"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => setEditingId(null)}
                          className="p-1 text-destructive hover:bg-destructive/10 rounded"
                          title="Batal"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 flex-1">
                        <h3 className="font-semibold text-base text-[var(--foreground)] truncate">
                          {template.name}
                        </h3>
                        <button
                          onClick={() => handleStartRename(template)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-[var(--muted-foreground)] hover:text-foreground transition-opacity"
                          title="Ubah Nama"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="mt-1 text-sm font-medium text-primary">
                    {template.client}
                  </p>

                  <div className="mt-4 space-y-1.5 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted-foreground)]">
                    <p>{itemsList.length} item invoice</p>
                    <p className="font-semibold text-sm text-[var(--foreground)]">
                      {formatCurrency(template.total, template.currency)}
                    </p>
                    {template.notes && (
                      <p className="truncate italic opacity-80 text-[11px]">
                        &quot;{template.notes}&quot;
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-[var(--border)] flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleInstantiate(template)}
                    disabled={isLoading}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
                  >
                    {isLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                    Buat Invoice
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(template.id)}
                    disabled={isLoading}
                    className="p-1.5 text-destructive/70 hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                    title="Hapus Template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Buat Template Baru */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--card)] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-lg font-semibold text-[var(--foreground)]">
                Buat Template Invoice Baru
              </h2>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-[var(--muted-foreground)] hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Nama Template *
                </label>
                <input
                  type="text"
                  required
                  placeholder="misal: Retainer Bulanan PT ABCD"
                  value={newTemplateName}
                  onChange={(e) => setNewTemplateName(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Nama Klien *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Nama Klien"
                  value={newClientName}
                  onChange={(e) => setNewClientName(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Mata Uang
                </label>
                <select
                  value={newCurrency}
                  onChange={(e) => setNewCurrency(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="IDR">IDR (Rupiah)</option>
                  <option value="USD">USD ($)</option>
                  <option value="EUR">EUR (€)</option>
                  <option value="SGD">SGD (S$)</option>
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-[var(--foreground)]">
                    Daftar Item *
                  </label>
                  <button
                    type="button"
                    onClick={addItemRow}
                    className="text-xs text-primary hover:underline flex items-center gap-1"
                  >
                    <Plus className="h-3 w-3" /> Tambah Item
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {newItems.map((item, idx) => (
                    <div key={idx} className="flex gap-2 items-center">
                      <input
                        type="text"
                        placeholder="Nama Item"
                        value={item.name}
                        onChange={(e) => updateItemRow(idx, "name", e.target.value)}
                        className="flex-2 w-1/2 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                        required
                      />
                      <input
                        type="number"
                        placeholder="Qty"
                        min={1}
                        value={item.qty}
                        onChange={(e) => updateItemRow(idx, "qty", parseInt(e.target.value) || 1)}
                        className="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                        required
                      />
                      <input
                        type="number"
                        placeholder="Harga"
                        min={0}
                        value={item.price}
                        onChange={(e) => updateItemRow(idx, "price", parseInt(e.target.value) || 0)}
                        className="w-24 rounded border border-[var(--border)] bg-[var(--background)] px-2 py-1 text-xs"
                        required
                      />
                      {newItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          className="text-destructive hover:bg-destructive/10 p-1 rounded"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--foreground)] mb-1">
                  Catatan (Opsional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Catatan default untuk invoice..."
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-sm text-[var(--foreground)] focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="rounded-md border border-[var(--border)] px-4 py-2 text-xs font-medium hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 inline-flex items-center gap-1.5"
                >
                  {createLoading && <Loader2 className="h-3 w-3 animate-spin" />}
                  Simpan Template
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
