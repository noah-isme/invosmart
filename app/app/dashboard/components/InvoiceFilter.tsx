"use client";

import { InvoiceStatus } from "@prisma/client";

import type { InvoiceFilterValue } from "./types";

type InvoiceFilterProps = {
  value: InvoiceFilterValue;
  onChange: (value: InvoiceFilterValue) => void;
};

const options: { label: string; value: InvoiceFilterValue }[] = [
  { label: "All", value: "ALL" },
  { label: "Draft", value: InvoiceStatus.DRAFT },
  { label: "Sent", value: InvoiceStatus.SENT },
  { label: "Paid", value: InvoiceStatus.PAID },
  { label: "Unpaid", value: InvoiceStatus.UNPAID },
  { label: "Overdue", value: InvoiceStatus.OVERDUE },
];

export const InvoiceFilter = ({ value, onChange }: InvoiceFilterProps) => {
  return (
    <div role="radiogroup" className="flex flex-wrap gap-2">
      {options.map((option) => {
        const isActive = option.value === value;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            onClick={() => onChange(option.value)}
            className={`rounded-full border px-4 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-transparent text-foreground hover:bg-muted"
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};
