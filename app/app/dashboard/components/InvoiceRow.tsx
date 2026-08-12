"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { DashboardInvoice } from "./types";
import {
  InvoiceStatusEnum,
  invoiceStatusValues,
  type InvoiceStatusValue,
} from "@/lib/schemas";
import { useTranslation } from "@/lib/i18n/context";

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
    "border border-white/10 bg-white/[0.05] text-text/60",
  [InvoiceStatusEnum.enum.SENT]:
    "border border-primary/40 bg-primary/15 text-primary/80",
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
  const { t } = useTranslation();
  const [selectedStatus, setSelectedStatus] = useState<InvoiceStatusValue>(invoice.status);

  const getStatusLabel = (status: InvoiceStatusValue) => {
    const key = `invoices.status.${status.toLowerCase()}`;
    const translated = t(key);
    return translated && translated !== key ? translated : statusLabels[status];
  };

  const updateDisabled = useMemo(
    () => disabled || selectedStatus === invoice.status,
    [disabled, selectedStatus, invoice.status],
  );

  return (
    <tr className="transition hover:bg-white/[0.02] flex flex-col sm:table-row border-b border-white/5 sm:border-0 p-4 sm:p-0 gap-3 sm:gap-0">
      <td className="px-2 py-1 sm:px-6 sm:py-5 align-top flex justify-between sm:table-cell w-full">
        <div className="space-y-1 w-1/2 sm:w-auto">
          <Link
            href={`/app/invoices/${invoice.id}`}
            className="text-sm font-semibold text-text hover:text-primary transition-colors duration-150"
          >
            {invoice.number}
          </Link>
          <Link
            href={`/app/invoices/${invoice.id}`}
            className="text-xs text-text/55 hover:text-primary transition-colors duration-150 block truncate"
          >
            {invoice.client}
          </Link>
        </div>
        <div className="text-right sm:hidden">
          <span
            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${statusStyles[invoice.status]}`}
          >
            {getStatusLabel(invoice.status)}
          </span>
        </div>
      </td>
      <td className="px-2 py-1 sm:px-6 sm:py-5 align-top block sm:table-cell">
        <div className="space-y-1 flex justify-between sm:block items-center">
          <p className="text-sm font-semibold text-text">{formatCurrency(invoice.total)}</p>
          <p className="text-xs text-text/45 hidden sm:block">
            Subtotal {formatCurrency(invoice.subtotal)} · Pajak {formatCurrency(invoice.tax)}
          </p>
          <p className="text-xs text-text/70 sm:hidden">Due: {formatDate(invoice.dueAt)}</p>
        </div>
      </td>
      <td className="px-6 py-5 align-top hidden sm:table-cell">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] ${statusStyles[invoice.status]}`}
        >
          {getStatusLabel(invoice.status)}
        </span>
      </td>
      <td className="px-6 py-5 align-top hidden sm:table-cell">
        <div className="space-y-1 text-xs text-text/60">
          <p className="uppercase tracking-[0.24em] text-text/40">Due</p>
          <p className="text-sm text-text/70">{formatDate(invoice.dueAt)}</p>
        </div>
      </td>
      <td className="px-2 py-2 sm:px-6 sm:py-5 align-top block sm:table-cell mt-2 sm:mt-0">
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
            className="w-full sm:w-auto rounded-2xl border border-white/10 bg-white/[0.05] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          >
            {invoiceStatusValues.map((status) => (
              <option key={status} value={status}>
                {getStatusLabel(status)}
              </option>
            ))}
          </select>

          <div className="flex gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={() => onUpdateStatus(invoice.id, selectedStatus)}
              disabled={updateDisabled}
              className="gradient-button flex-1 sm:w-auto rounded-2xl px-3 py-2 text-sm font-semibold text-text transition disabled:cursor-not-allowed disabled:opacity-60"
            >
              Update
            </button>
            <button
              type="button"
              onClick={() => onDelete(invoice.id)}
              disabled={disabled}
              className="flex-1 sm:w-auto rounded-2xl border border-white/10 px-3 py-2 text-sm font-semibold text-rose-300 transition hover:border-rose-300/40 hover:text-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Delete
            </button>
          </div>
        </div>
      </td>
    </tr>
  );
};
