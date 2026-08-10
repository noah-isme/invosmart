"use client";
import { ReceiptScanner } from "../ReceiptScanner";
import { useState } from "react";
import { AIInvoicePreview } from "../../ai-invoice/AIInvoicePreview";
import type { InvoiceFormInitialValues } from "@/components/invoices/InvoiceFormClient";

export const ReceiptScannerWrapper = () => {
    const [draft, setDraft] = useState<InvoiceFormInitialValues | null>(null);

    return (
        <div className="space-y-10">
            <ReceiptScanner
              onScanSuccess={(data) => {
                setDraft({
                    client: data.client,
                    dueAt: data.dueAt ?? null,
                    notes: data.notes ?? "",
                    items: data.items.map((item) => ({
                      name: item.name,
                      qty: item.qty,
                      price: item.price,
                    })),
                });
              }}
            />
            {draft && (
                <AIInvoicePreview ready={true} loading={false} draft={draft} />
            )}
        </div>
    )
}
