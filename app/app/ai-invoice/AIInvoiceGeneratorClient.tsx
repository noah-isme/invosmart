"use client";

import { useState } from "react";
import { z } from "zod";

import { AIInvoiceSchema } from "@/lib/schemas";
import type { InvoiceFormInitialValues } from "@/components/invoices/InvoiceFormClient";

import { AIInvoicePreview } from "./AIInvoicePreview";
import { AIInvoicePrompt } from "./AIInvoicePrompt";

type AIInvoiceDraft = z.infer<typeof AIInvoiceSchema>;

const toFormValues = (draft: AIInvoiceDraft): InvoiceFormInitialValues => ({
  client: draft.client,
  dueAt: draft.dueAt ?? null,
  notes: draft.notes ?? "",
  items: draft.items.map((item) => ({
    name: item.name,
    qty: item.qty,
    price: item.price,
  })),
});

const defaultDraft: InvoiceFormInitialValues = {
  client: "",
  dueAt: null,
  notes: "",
  items: [{ name: "", qty: 1, price: 0 }],
};

export const AIInvoiceGeneratorClient = () => {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<InvoiceFormInitialValues>(defaultDraft);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError("Mohon tuliskan kebutuhan invoice terlebih dahulu.");
      return;
    }

    setLoading(true);
    setError(null);

    let fallbackValues: InvoiceFormInitialValues | null = null;

    try {
      const response = await fetch("/api/invoices/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });

      const body = await response.json().catch(() => null);

      if (!response.ok) {
        if (body?.fallback) {
          const parsedFallback = AIInvoiceSchema.safeParse(body.fallback);
          fallbackValues = parsedFallback.success
            ? toFormValues(parsedFallback.data)
            : defaultDraft;
        }

        throw new Error(body?.error ?? "Gagal menghasilkan invoice dari AI.");
      }

      const parsed = AIInvoiceSchema.safeParse(body?.data);

      if (!parsed.success) {
        throw new Error("Respons AI tidak valid.");
      }

      setDraft(toFormValues(parsed.data));
      setReady(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Gagal menghasilkan invoice.";
      setError(message);

      setDraft(fallbackValues ?? defaultDraft);
      setReady(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8">
      <AIInvoicePrompt
        prompt={prompt}
        onPromptChange={setPrompt}
        onGenerate={handleGenerate}
        loading={loading}
        error={error}
      />

      <AIInvoicePreview ready={ready} loading={loading} draft={draft} />
    </div>
  );
};

