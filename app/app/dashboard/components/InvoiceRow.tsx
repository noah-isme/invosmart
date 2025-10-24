"use client";

import { useMemo, useState } from "react";

import type { DashboardInvoice } from "./types";
import {
  InvoiceStatusEnum,
  invoiceStatusValues,
  type InvoiceStatusValue,
} from "@/lib/schemas";

type InvoiceRowProps = {
  invoice: DashboardInvoice;
  disabled?: boolean;
  onUpdateStatus: (invoiceId: string, status: InvoiceStatusValue) => void;
  onDelete: (invoiceId: string) => void;
};

const statusLabels: Record<InvoiceStatusValue, string> = {
  [InvoiceStatusEnum.enum.DRAFT]: "Draft",
  [InvoiceStatusEnum.enum.SENT]: "Sent",
  [InvoiceStatusEnum.enum.PAID]: "Paid",
  [InvoiceStatusEnum.enum.UNPAID]: "Unpaid",
  [InvoiceStatusEnum.enum.OVERDUE]: "Overdue",
};

const statusStyles: Record<InvoiceStatusValue, string> = {
  [InvoiceStatusEnum.enum.DRAFT]:
    "border border-white/10 bg-white/[0.05] text-white/60",
  [InvoiceStatusEnum.enum.SENT]:
    "border border-[#6366F1]/40 bg-[#6366F1]/15 text-[#A5B4FC]",
  [InvoiceStatusEnum.enum.PAID]:
    "border border-emerald-400/40 bg-emerald-500/10 text-emerald-200",
  [InvoiceStatusEnum.enum.UNPAID]:
    "border border-amber-400/40 bg-amber-500/10 text-amber-200",
  [InvoiceStatusEnum.enum.OVERDUE]:
    "border border-rose-500/40 bg-rose-500/15 text-rose-200",
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);

const formatDate = (value: string | null) => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

export const InvoiceRow = ({ invoice, disabled, onUpdateStatus, onDelete }: InvoiceRowProps) => {
  const [selectedStatus, setSelectedStatus] = useState<InvoiceStatusValue>(invoice.status);

  const updateDisabled = useMemo(
    () => disabled || selectedStatus === invoice.status,
    [disabled, selectedStatus, invoice.status],
  );

  return (
    <tr className="transition hover:bg-white/[0.02]">
      <td className="px-6 py-5 align-top">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">{invoice.number}</p>
          <p className="text-xs text-white/55">{invoice.client}</p>
        </div>
      </td>
      <td className="px-6 py-5 align-top">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-white">{formatCurrency(invoice.total)}</p>
          <p className="text-xs text-white/45">
            Subtotal {formatCurrency(invoice.subtotal)} · Pajak {formatCurrency(invoice.tax)}
          </p>
        </div>
      </td>
      <td className="px-6 py-5 align-top">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${statusStyles[invoice.status]}`}
        >
          {statusLabels[invoice.status]}
        </span>
      </td>
      <td className="px-6 py-5 align-top">
        <div className="space-y-1 text-xs text-white/60">
          <p className="uppercase tracking-[0.24em] text-white/40">Due</p>
          <p className="text-sm text-white/70">{formatDate(invoice.dueAt)}</p>
        </div>
      </td>
      <td className="px-6 py-5 align-top">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="sr-only" htmlFor={`invoice-status-${invoice.id}`}>
            Status invoice {invoice.number}
          </label>
          <select
            id={`invoice-status-${invoice.id}`}
            value={selectedStatus}
            disabled={disabled}
            onChange={(event) =>
              setSelectedStatus(event.target.value as InvoiceStatusValue)
            }
            className="w-full rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E1016]"
          >
            {invoiceStatusValues.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status]}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => onUpdateStatus(invoice.id, selectedStatus)}
            disabled={updateDisabled}
            className="gradient-button w-full rounded-2xl px-3 py-2 text-sm font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60"
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => onDelete(invoice.id)}
            disabled={disabled}
            className="w-full rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-300/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};
