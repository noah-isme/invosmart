"use client";

import { motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type {
  DashboardInvoice,
  InvoiceDashboardStats,
  InvoiceFilterValue,
  InvoiceFilterCounts,
} from "./types";
import { DashboardStats } from "./DashboardStats";
import { InvoiceFilter } from "./InvoiceFilter";
import { InvoiceTable } from "./InvoiceTable";
import { InvoiceStatusEnum, type InvoiceStatusValue } from "@/lib/schemas";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";

const DEFAULT_STATS: InvoiceDashboardStats = {
  revenue: 0,
  unpaid: 0,
  overdue: 0,
};

const DEFAULT_FILTER_COUNTS: InvoiceFilterCounts = {
  ALL: 0,
  [InvoiceStatusEnum.enum.DRAFT]: 0,
  [InvoiceStatusEnum.enum.SENT]: 0,
  [InvoiceStatusEnum.enum.PAID]: 0,
  [InvoiceStatusEnum.enum.UNPAID]: 0,
  [InvoiceStatusEnum.enum.OVERDUE]: 0,
};

const statusToLabel: Record<InvoiceStatusValue, string> = {
  [InvoiceStatusEnum.enum.DRAFT]: "Draft",
  [InvoiceStatusEnum.enum.SENT]: "Sent",
  [InvoiceStatusEnum.enum.PAID]: "Paid",
  [InvoiceStatusEnum.enum.UNPAID]: "Unpaid",
  [InvoiceStatusEnum.enum.OVERDUE]: "Overdue",
};

const fetchErrorMessage =
  "Kami kesulitan memuat data invoice sekarang. Coba muat ulang atau buat invoice baru.";

type AppRouterInstance = ReturnType<typeof useRouter> | null;

const useOptionalRouter = (): AppRouterInstance => {
  try {
    return useRouter();
  } catch {
    return null;
  }
};

const sectionFade = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0 },
};

export const DashboardContent = () => {
  const [filter, setFilter] = useState<InvoiceFilterValue>("ALL");
  const [invoices, setInvoices] = useState<DashboardInvoice[]>([]);
  const [stats, setStats] = useState<InvoiceDashboardStats>(DEFAULT_STATS);
  const [filterCounts, setFilterCounts] = useState<InvoiceFilterCounts>(DEFAULT_FILTER_COUNTS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const router = useOptionalRouter();

  const fetchInvoices = useCallback(async (targetFilter: InvoiceFilterValue) => {
    setLoading(true);
    setError(null);

    try {
      const query = targetFilter === "ALL" ? "" : `?status=${encodeURIComponent(targetFilter)}`;
      const response = await fetch(`/api/invoices${query}`);

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error ?? fetchErrorMessage);
      }

      const payload = (await response.json()) as {
        data: DashboardInvoice[];
        stats: InvoiceDashboardStats;
        filterCounts: InvoiceFilterCounts;
      };

      setInvoices(Array.isArray(payload.data) ? payload.data : []);
      setStats(payload.stats ?? DEFAULT_STATS);
      setFilterCounts(payload.filterCounts ?? { ...DEFAULT_FILTER_COUNTS });
    } catch (err) {
      const message = err instanceof Error ? err.message : fetchErrorMessage;
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInvoices("ALL");
  }, [fetchInvoices]);

  const handleFilterChange = useCallback(
    (value: InvoiceFilterValue) => {
      setFilter(value);
      void fetchInvoices(value);
    },
    [fetchInvoices],
  );

  const handleUpdateStatus = useCallback(
    async (invoiceId: string, status: InvoiceStatusValue) => {
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
            taxRate: 0.1,
          }),
        });

        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(body?.error ?? "Gagal memperbarui invoice.");
        }

        await fetchInvoices(filter);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal memperbarui invoice.";
        setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [fetchInvoices, invoices, filter],
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

        await fetchInvoices(filter);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Gagal menghapus invoice.";
        setError(message);
      } finally {
        setPendingId(null);
      }
    },
    [fetchInvoices, filter],
  );

  const subtitle = useMemo(() => {
    if (filter === "ALL") {
      return "Pantau seluruh invoice milik Anda dalam satu tempat.";
    }

    return `Menampilkan invoice dengan status ${statusToLabel[filter as InvoiceStatusValue]}.`;
  }, [filter]);

  return (
    <motion.section
      initial="hidden"
      animate="visible"
      variants={{ hidden: { opacity: 0 }, visible: { opacity: 1 } }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-10"
    >
      <motion.header
        variants={sectionFade}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="space-y-4"
      >
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-[0.42em] text-text/50">Ringkasan operasional</p>
          <h1 className="text-4xl font-semibold text-text">Dashboard invoice</h1>
          <p className="max-w-2xl text-base text-text/65">{subtitle}</p>
        </div>
        {error ? (
          <div
            role="alert"
            className="glass-surface flex flex-col items-start gap-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-5 text-sm text-red-50 shadow-[0_18px_45px_rgba(239,68,68,0.12)] md:flex-row md:items-center md:justify-between"
          >
            <div className="space-y-1">
              <p className="text-base font-semibold text-red-100">Ups, dashboard kami lagi bermasalah</p>
              <p className="text-sm text-red-50/80">{error}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                onClick={() => {
                  void fetchInvoices(filter);
                }}
              >
                Coba lagi
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  router?.push?.("/app/invoices/new");
                }}
              >
                Buat invoice baru
              </Button>
            </div>
          </div>
        ) : null}
      </motion.header>

      <motion.div variants={sectionFade} transition={{ delay: 0.05, duration: 0.35, ease: "easeOut" }}>
        {loading ? (
          <div className="grid gap-5 md:grid-cols-3">
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <DashboardStats stats={stats} />
        )}
      </motion.div>

      <motion.div variants={sectionFade} transition={{ delay: 0.1, duration: 0.35, ease: "easeOut" }}>
        <InvoiceFilter value={filter} onChange={handleFilterChange} counts={filterCounts} />
      </motion.div>

      <motion.div variants={sectionFade} transition={{ delay: 0.15, duration: 0.35, ease: "easeOut" }}>
        <InvoiceTable
          invoices={invoices}
          loading={loading}
          pendingId={pendingId}
          filter={filter}
          onUpdateStatus={handleUpdateStatus}
          onDelete={handleDelete}
          onCreateInvoice={() => {
            router?.push?.("/app/invoices/new");
          }}
        />
      </motion.div>
    </motion.section>
  );
};
