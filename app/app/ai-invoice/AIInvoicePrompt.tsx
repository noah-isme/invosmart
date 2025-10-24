"use client";

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
      className="space-y-5 rounded-2xl border border-border bg-card/80 p-6 shadow-lg shadow-black/10"
    >
      <header className="space-y-2">
        <p className="text-xs uppercase text-primary/80">AI Invoice Generator</p>
        <h1 className="text-2xl font-semibold text-foreground">Buat draft invoice dari perintah natural language</h1>
        <p className="text-sm text-muted-foreground">
          Jelaskan kebutuhan invoice Anda secara singkat. Contoh: &quot;Buat invoice 2 juta untuk jasa desain logo klien ABC&quot;.
        </p>
      </header>

      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-foreground">Instruksi AI</span>
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="Tuliskan detail pekerjaan, nilai total, dan informasi klien..."
          className="min-h-[140px] rounded-xl border border-border bg-background px-4 py-3 text-sm text-foreground shadow-inner focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          disabled={loading}
          aria-describedby={error ? "ai-prompt-error" : undefined}
          aria-invalid={error ? "true" : undefined}
        />
      </label>

      {error ? (
        <p
          id="ai-prompt-error"
          role="alert"
          className="rounded-lg border border-destructive/60 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          {error}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          AI akan mengonversi instruksi Anda menjadi draft invoice yang dapat diedit.
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-xs text-muted-foreground">
          Pastikan informasi sensitif tidak disertakan dalam prompt.
        </span>
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Menghasilkan draft..." : "Generate Draft"}
        </button>
      </div>
    </form>
  );
};

