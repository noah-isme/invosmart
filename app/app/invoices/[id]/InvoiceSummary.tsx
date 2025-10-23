import { InvoiceStatusEnum, type InvoiceStatusValue } from "@/lib/schemas";
import type { InvoiceDetail } from "./types";

const dateFormatter = new Intl.DateTimeFormat("id-ID", {
  dateStyle: "medium",
  timeStyle: "short",
});

const statusLabels: Record<InvoiceStatusValue, { label: string; className: string }> = {
  [InvoiceStatusEnum.enum.DRAFT]: {
    label: "Draft",
    className: "bg-muted text-muted-foreground",
  },
  [InvoiceStatusEnum.enum.SENT]: {
    label: "Terkirim",
    className: "bg-blue-500/10 text-blue-400",
  },
  [InvoiceStatusEnum.enum.PAID]: {
    label: "Lunas",
    className: "bg-emerald-500/10 text-emerald-400",
  },
  [InvoiceStatusEnum.enum.UNPAID]: {
    label: "Belum Dibayar",
    className: "bg-amber-500/10 text-amber-400",
  },
  [InvoiceStatusEnum.enum.OVERDUE]: {
    label: "Overdue",
    className: "bg-red-500/10 text-red-400",
  },
};

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return dateFormatter.format(date);
};

type InvoiceSummaryProps = {
  invoice: InvoiceDetail;
};

export const InvoiceSummary = ({ invoice }: InvoiceSummaryProps) => {
  const statusConfig = statusLabels[invoice.status];

  return (
    <section className="space-y-6 rounded-lg border border-border bg-card p-6 shadow-sm">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Invoice #{invoice.number}</p>
          <h1 className="text-3xl font-semibold">{invoice.client}</h1>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-medium ${statusConfig.className}`}
        >
          {statusConfig.label}
        </span>
      </header>

      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Tanggal Terbit</dt>
          <dd className="text-sm">{formatDate(invoice.issuedAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Jatuh Tempo</dt>
          <dd className="text-sm">{formatDate(invoice.dueAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Status Pembayaran</dt>
          <dd className="text-sm">{formatDate(invoice.paidAt)}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs font-semibold uppercase text-muted-foreground">Total Tagihan</dt>
          <dd className="text-lg font-semibold">
            {new Intl.NumberFormat("id-ID", {
              style: "currency",
              currency: "IDR",
              maximumFractionDigits: 0,
            }).format(invoice.total)}
          </dd>
        </div>
      </dl>

      {invoice.notes ? (
        <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Catatan</p>
          <p className="mt-1 leading-relaxed">{invoice.notes}</p>
        </div>
      ) : null}
    </section>
  );
};
