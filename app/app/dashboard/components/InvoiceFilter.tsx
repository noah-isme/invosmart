"use client";

import { motion } from "framer-motion";

import type { InvoiceFilterValue } from "./types";
import { InvoiceStatusEnum } from "@/lib/schemas";

type InvoiceFilterProps = {
  value: InvoiceFilterValue;
  onChange: (value: InvoiceFilterValue) => void;
};

const options: { label: string; value: InvoiceFilterValue }[] = [
  { label: "All", value: "ALL" },
  { label: "Draft", value: InvoiceStatusEnum.enum.DRAFT },
  { label: "Sent", value: InvoiceStatusEnum.enum.SENT },
  { label: "Paid", value: InvoiceStatusEnum.enum.PAID },
  { label: "Unpaid", value: InvoiceStatusEnum.enum.UNPAID },
  { label: "Overdue", value: InvoiceStatusEnum.enum.OVERDUE },
];

export const InvoiceFilter = ({ value, onChange }: InvoiceFilterProps) => {
  return (
    <div
      role="radiogroup"
      className="glass-surface flex flex-wrap gap-3 rounded-[22px] border border-white/5 bg-white/[0.04] p-3"
    >
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <motion.button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            whileTap={{ scale: 0.94 }}
            className={`relative inline-flex items-center justify-center rounded-full px-5 py-2 text-xs font-semibold uppercase tracking-[0.24em] transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg ${
              isActive
                ? "bg-gradient-to-r from-primary to-accent text-text shadow-[0_15px_40px_rgba(var(--color-primary)_/_0.35)]"
                : "border border-white/10 bg-transparent text-text/60 hover:border-white/20 hover:text-text"
            }`}
          >
            {option.label}
          </motion.button>
        );
      })}
    </div>
  );
};
