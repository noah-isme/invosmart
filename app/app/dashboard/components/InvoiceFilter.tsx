"use client";

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
