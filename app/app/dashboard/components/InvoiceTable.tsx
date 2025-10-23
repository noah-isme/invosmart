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
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="min-w-full divide-y divide-border">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-3 font-medium">
              Invoice
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Nilai
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Status
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Jatuh Tempo
            </th>
            <th scope="col" className="px-4 py-3 font-medium">
              Aksi
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border bg-background text-sm">
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
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          Memuat data invoice...
        </p>
      ) : null}

      {!loading && invoices.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          Belum ada invoice pada filter ini.
        </p>
      ) : null}
    </div>
  );
};
