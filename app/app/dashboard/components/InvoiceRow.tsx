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
  [InvoiceStatusEnum.enum.DRAFT]: "bg-muted text-muted-foreground",
  [InvoiceStatusEnum.enum.SENT]: "bg-blue-500/10 text-blue-400",
  [InvoiceStatusEnum.enum.PAID]: "bg-emerald-500/10 text-emerald-400",
  [InvoiceStatusEnum.enum.UNPAID]: "bg-amber-500/10 text-amber-400",
  [InvoiceStatusEnum.enum.OVERDUE]: "bg-red-500/10 text-red-400",
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
    <tr>
      <td className="px-4 py-4 align-top">
        <div className="space-y-1">
          <p className="font-medium">{invoice.number}</p>
          <p className="text-sm text-muted-foreground">{invoice.client}</p>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="space-y-1">
          <p className="font-medium">{formatCurrency(invoice.total)}</p>
          <p className="text-xs text-muted-foreground">
            Subtotal {formatCurrency(invoice.subtotal)} · Pajak {formatCurrency(invoice.tax)}
          </p>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${statusStyles[invoice.status]}`}
        >
          {statusLabels[invoice.status]}
        </span>
      </td>
      <td className="px-4 py-4 align-top">
        <div className="space-y-1 text-sm">
          <p>Jatuh tempo</p>
          <p className="text-muted-foreground">{formatDate(invoice.dueAt)}</p>
        </div>
      </td>
      <td className="px-4 py-4 align-top">
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
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
            className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
          >
            Update
          </button>
          <button
            type="button"
            onClick={() => onDelete(invoice.id)}
            disabled={disabled}
            className="w-full rounded-md border border-border px-3 py-2 text-sm font-medium text-destructive transition-opacity hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </td>
    </tr>
  );
};
