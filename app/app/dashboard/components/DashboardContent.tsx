"use client";

import { InvoiceStatus } from "@prisma/client";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  DashboardInvoice,
  InvoiceDashboardStats,
  InvoiceFilterValue,
} from "./types";
import { DashboardStats } from "./DashboardStats";
import { InvoiceFilter } from "./InvoiceFilter";
import { InvoiceTable } from "./InvoiceTable";

const DEFAULT_STATS: InvoiceDashboardStats = {
  revenue: 0,
  unpaid: 0,
  overdue: 0,
};

const statusToLabel: Record<InvoiceStatus, string> = {
  [InvoiceStatus.DRAFT]: "Draft",
  [InvoiceStatus.SENT]: "Sent",
  [InvoiceStatus.PAID]: "Paid",
  [InvoiceStatus.UNPAID]: "Unpaid",
  [InvoiceStatus.OVERDUE]: "Overdue",
};

const fetchErrorMessage = "Gagal memuat data invoice. Coba lagi.";

export const DashboardContent = () => {
  const [filter, setFilter] = useState<InvoiceFilterValue>("ALL");
  const [invoices, setInvoices] = useState<DashboardInvoice[]>([]);
  const [stats, setStats] = useState<InvoiceDashboardStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const query = filter === "ALL" ? "" : `?status=${filter}`;
      const response = await fetch(`/api/invoices${query}`);

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? fetchErrorMessage);
      }

      const payload = (await response.json()) as {
        data: DashboardInvoice[];
        stats: InvoiceDashboardStats;
      };

      setInvoices(Array.isArray(payload.data) ? payload.data : []);
      setStats(payload.stats ?? DEFAULT_STATS);
    } catch (err) {
      const message = err instanceof Error ? err.message : fetchErrorMessage;
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void fetchInvoices();
  }, [fetchInvoices]);

  const handleFilterChange = useCallback((value: InvoiceFilterValue) => {
    setFilter(value);
  }, []);

  const handleUpdateStatus = useCallback(
    async (invoiceId: string, status: InvoiceStatus) => {
      const target = invoices.find((invoice) => invoice.id === invoiceId);
      if (!target) {
        return;
      }

      setPendingId(invoiceId);
      setError(null);

      try {
        const response = await fetch(`/api/invoices/${invoiceId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: invoiceId,
            client: target.client,
            items: target.items,
            subtotal: target.subtotal,
            tax: target.tax,
            total: target.total,
            status,
            issuedAt: target.issuedAt,
            dueAt: target.dueAt,
            notes: target.notes,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Gagal memperbarui invoice.");
        }

        await fetchInvoices();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal memperbarui invoice.";
        setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [fetchInvoices, invoices],
  );

  const handleDelete = useCallback(
    async (invoiceId: string) => {
      setPendingId(invoiceId);
      setError(null);

      try {
        const response = await fetch(`/api/invoices/${invoiceId}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Gagal menghapus invoice.");
        }

        await fetchInvoices();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal menghapus invoice.";
        setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [fetchInvoices],
  );

  const subtitle = useMemo(() => {
    if (filter === "ALL") {
      return "Pantau seluruh invoice milik Anda dalam satu tempat.";
    }

    return `Menampilkan invoice dengan status ${statusToLabel[filter as InvoiceStatus]}.`;
  }, [filter]);

  return (
    <section className="space-y-6">
      <header className="space-y-2">
        <div>
          <h1 className="text-3xl font-semibold">Dashboard Invoice</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}
      </header>

      <DashboardStats stats={stats} />

      <InvoiceFilter value={filter} onChange={handleFilterChange} />

      <InvoiceTable
        invoices={invoices}
        loading={loading}
        pendingId={pendingId}
        onUpdateStatus={handleUpdateStatus}
        onDelete={handleDelete}
      />
    </section>
  );
};
