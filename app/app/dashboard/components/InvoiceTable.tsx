"use client";

import { InvoiceRow } from "./InvoiceRow";
import type { DashboardInvoice } from "./types";
import type { InvoiceStatusValue } from "@/lib/schemas";

type InvoiceTableProps = {
  invoices: DashboardInvoice[];
  loading: boolean;
  pendingId: string | null;
  onUpdateStatus: (invoiceId: string, status: InvoiceStatusValue) => void;
  onDelete: (invoiceId: string) => void;
};

export const InvoiceTable = ({
  invoices,
  loading,
  pendingId,
  onUpdateStatus,
  onDelete,
}: InvoiceTableProps) => {
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
          {invoices.map((invoice) => (
            <InvoiceRow
              key={`${invoice.id}-${invoice.status}`}
              invoice={invoice}
              disabled={pendingId === invoice.id}
              onUpdateStatus={onUpdateStatus}
              onDelete={onDelete}
            />
          ))}
        </tbody>
      </table>

      {loading ? (
        <p className="px-6 py-10 text-center text-sm text-text/60">Memuat data invoice...</p>
      ) : null}

      {!loading && invoices.length === 0 ? (
        <p className="px-6 py-10 text-center text-sm text-text/60">
          Belum ada invoice pada filter ini.
        </p>
      ) : null}
    </div>
  );
};
