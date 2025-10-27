"use client";

import { InvoiceRow } from "./InvoiceRow";
import type { DashboardInvoice, InvoiceFilterValue } from "./types";
import type { InvoiceStatusValue } from "@/lib/schemas";
import { Skeleton } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";
import { Inbox, Plus } from "lucide-react";

type InvoiceTableProps = {
  invoices: DashboardInvoice[];
  loading: boolean;
  pendingId: string | null;
  filter: InvoiceFilterValue;
  onUpdateStatus: (invoiceId: string, status: InvoiceStatusValue) => void;
  onDelete: (invoiceId: string) => void;
  onCreateInvoice: () => void;
};

export const InvoiceTable = ({
  invoices,
  loading,
  pendingId,
  filter,
  onUpdateStatus,
  onDelete,
  onCreateInvoice,
}: InvoiceTableProps) => {
  const filterLabel: Record<InvoiceFilterValue, { title: string; subtitle: string }> = {
    ALL: {
      title: "Belum ada invoice yang tersimpan",
      subtitle: "Catat transaksi pertama Anda untuk melihat insight dan metrik di dashboard.",
    },
    DRAFT: {
      title: "Belum ada draft invoice",
      subtitle: "Gunakan draft untuk menyiapkan invoice sebelum dikirim ke klien.",
    },
    SENT: {
      title: "Belum ada invoice yang terkirim",
      subtitle: "Kirim invoice Anda agar statusnya tercatat sebagai SENT.",
    },
    PAID: {
      title: "Belum ada invoice yang lunas",
      subtitle: "Catat pembayaran invoice untuk melacak revenue yang sudah diterima.",
    },
    UNPAID: {
      title: "Belum ada invoice yang belum dibayar",
      subtitle: "Invoice yang belum dibayar akan muncul di sini setelah Anda menerbitkannya.",
    },
    OVERDUE: {
      title: "Tidak ada invoice yang melewati jatuh tempo",
      subtitle: "Tetap pantau jatuh tempo pembayaran agar cashflow Anda sehat.",
    },
  };

  return (
    <div className="glass-surface overflow-hidden rounded-[28px] border border-white/8 bg-white/[0.03] shadow-[0_24px_70px_rgba(8,10,16,0.55)]">
      <table className="min-w-full divide-y divide-white/5">
        <thead className="bg-white/[0.04] text-left text-[0.68rem] uppercase tracking-[0.32em] text-text/45">
          <tr>
            <th scope="col" className="px-6 py-3 font-medium">Invoice</th>
            <th scope="col" className="px-6 py-3 font-medium">Nilai</th>
            <th scope="col" className="px-6 py-3 font-medium">Status</th>
            <th scope="col" className="px-6 py-3 font-medium">Jatuh Tempo</th>
            <th scope="col" className="px-6 py-3 font-medium">Aksi</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 bg-transparent text-sm text-text/85">
          {loading
            ? Array.from({ length: 4 }).map((_, index) => (
                <tr key={`skeleton-${index}`}>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-32" rounded="lg" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-20" rounded="lg" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-24" rounded="lg" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-4 w-24" rounded="lg" /></td>
                  <td className="px-6 py-4"><Skeleton className="h-8 w-28" /></td>
                </tr>
              ))
            : invoices.length > 0
              ? invoices.map((invoice) => (
                  <InvoiceRow
                    key={`${invoice.id}-${invoice.status}`}
                    invoice={invoice}
                    disabled={pendingId === invoice.id}
                    onUpdateStatus={onUpdateStatus}
                    onDelete={onDelete}
                  />
                ))
              : (
                  <tr>
                    <td className="px-6 py-14" colSpan={5}>
                      <div className="mx-auto flex max-w-xl flex-col items-center gap-5 text-center">
                        <span className="flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                          <Inbox className="size-7" aria-hidden />
                        </span>
                        <div className="space-y-2">
                          <h3 className="text-lg font-semibold text-text">{filterLabel[filter].title}</h3>
                          <p className="text-sm text-text/70">{filterLabel[filter].subtitle}</p>
                        </div>
                        <Button onClick={onCreateInvoice} className="gap-2">
                          <Plus className="size-4" aria-hidden />
                          Buat invoice baru
                        </Button>
                      </div>
                    </td>
                  </tr>
                )}
        </tbody>
      </table>
    </div>
  );
};
