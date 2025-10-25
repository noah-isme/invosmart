"use client";

import { motion } from "framer-motion";
import { FormEvent } from "react";

type AIInvoicePromptProps = {
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  loading: boolean;
  error?: string | null;
};

export const AIInvoicePrompt = ({
  prompt,
  onPromptChange,
  onGenerate,
  loading,
  error,
}: AIInvoicePromptProps) => {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onGenerate();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="glass-surface relative overflow-hidden rounded-[30px] border border-white/5 bg-white/[0.04] p-8 shadow-[0_28px_70px_rgba(8,10,16,0.55)]"
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.18),_transparent_55%)]" />
      <header className="relative space-y-3">
        <p className="text-xs uppercase tracking-[0.42em] text-text/50">AI invoice generator</p>
        <h1 className="text-3xl font-semibold text-text">Buat draft invoice dari perintah natural language</h1>
        <p className="text-sm text-text/65">
          Jelaskan kebutuhan invoice Anda secara singkat. Contoh: “Buat invoice 2 juta untuk jasa desain logo klien ABC”.
        </p>
      </header>

      <label className="relative mt-6 flex flex-col gap-3">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.32em] text-text/55">Instruksi AI</span>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Tuliskan detail pekerjaan, nilai total, dan informasi klien..."
          className="min-h-[150px] rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
          disabled={loading}
          aria-describedby={error ? "ai-prompt-error" : undefined}
          aria-invalid={error ? "true" : undefined}
        />
      </label>

      {error ? (
        <p
          id="ai-prompt-error"
          role="alert"
          className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200"
        >
          {error}
        </p>
      ) : (
        <p className="mt-4 text-xs text-text/55" aria-live="polite">
          AI akan mengonversi instruksi Anda menjadi draft invoice yang dapat diedit.
        </p>
      )}

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-text/55">
          Hindari informasi sensitif saat memberikan instruksi kepada AI.
        </span>
        <motion.button
          type="submit"
          whileTap={{ scale: 0.95 }}
          disabled={loading}
          className="gradient-button inline-flex items-center justify-center rounded-2xl px-6 py-2 text-sm font-semibold text-text disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Menghasilkan draft..." : "Generate draft"}
        </motion.button>
      </div>
    </form>
  );
};

