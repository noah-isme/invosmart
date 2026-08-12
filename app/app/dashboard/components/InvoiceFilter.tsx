"use client";

import { motion } from "framer-motion";
import { Download, FileText } from "lucide-react";

import type { InvoiceFilterCounts, InvoiceFilterValue } from "./types";
import { InvoiceStatusEnum } from "@/lib/schemas";

type InvoiceFilterProps = {
  value: InvoiceFilterValue;
  onChange: (value: InvoiceFilterValue) => void;
  counts?: InvoiceFilterCounts;
  onExportCSV?: () => void;
  onExportExcel?: () => void;
};

const options: { label: string; value: InvoiceFilterValue }[] = [
  { label: "All", value: "ALL" },
  { label: "Draft", value: InvoiceStatusEnum.enum.DRAFT },
  { label: "Sent", value: InvoiceStatusEnum.enum.SENT },
  { label: "Paid", value: InvoiceStatusEnum.enum.PAID },
  { label: "Unpaid", value: InvoiceStatusEnum.enum.UNPAID },
  { label: "Overdue", value: InvoiceStatusEnum.enum.OVERDUE },
];

export const InvoiceFilter = ({
  value,
  onChange,
  counts,
  onExportCSV,
  onExportExcel,
}: InvoiceFilterProps) => {
  const handleExportCSV = () => {
    if (onExportCSV) {
      onExportCSV();
    } else {
      const query = value !== "ALL" ? `?format=csv&status=${encodeURIComponent(value)}` : "?format=csv";
      window.open(`/api/invoices/export${query}`, "_blank");
    }
  };

  const handleExportExcel = () => {
    if (onExportExcel) {
      onExportExcel();
    } else {
      const query = value !== "ALL" ? `?format=xlsx&status=${encodeURIComponent(value)}` : "?format=xlsx";
      window.open(`/api/invoices/export${query}`, "_blank");
    }
  };

  return (
    <div className="glass-surface flex flex-col gap-4 rounded-[22px] border border-white/5 bg-white/[0.04] p-4 lg:flex-row lg:items-center lg:justify-between">
      <div role="radiogroup" className="flex flex-wrap items-center gap-4">
        {options.map((option) => {
          const isActive = option.value === value;
          const count = counts?.[option.value] ?? 0;

          return (
            <motion.button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => onChange(option.value)}
              whileTap={{ scale: 0.94 }}
              className={`relative inline-flex items-center justify-center gap-3 rounded-full px-6 py-2.5 text-xs font-semibold uppercase tracking-[0.24em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
                isActive
                  ? "bg-gradient-to-r from-primary to-accent text-text shadow-[0_15px_40px_rgba(var(--color-primary)_/_0.35)]"
                  : "border border-white/10 bg-transparent text-text/60 hover:border-white/20 hover:text-text"
              }`}
            >
              <span>{option.label}</span>
              <span
                className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 text-[0.6rem] tracking-widest ${
                  isActive ? "bg-white/15 text-text" : "bg-white/5 text-text/70"
                }`}
                aria-hidden
              >
                {count}
              </span>
            </motion.button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 lg:pt-0">
        <motion.button
          type="button"
          onClick={handleExportCSV}
          whileTap={{ scale: 0.94 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-text/80 transition-all hover:border-white/20 hover:bg-white/10 hover:text-text focus-visible:outline-none"
          title="Export CSV"
          aria-label="Export CSV"
        >
          <FileText className="h-3.5 w-3.5" />
          <span>Export CSV</span>
        </motion.button>
        <motion.button
          type="button"
          onClick={handleExportExcel}
          whileTap={{ scale: 0.94 }}
          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2.5 text-xs font-semibold uppercase tracking-[0.18em] text-text/80 transition-all hover:border-white/20 hover:bg-white/10 hover:text-text focus-visible:outline-none"
          title="Export Excel"
          aria-label="Export Excel"
        >
          <Download className="h-3.5 w-3.5" />
          <span>Export Excel</span>
        </motion.button>
      </div>
    </div>
  );
};

