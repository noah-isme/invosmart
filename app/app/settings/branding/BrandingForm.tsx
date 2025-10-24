"use client";

import { type FormEvent, useMemo, useState } from "react";

type BrandingFormState = {
  logoUrl: string;
  primaryColor: string;
  fontFamily: "sans" | "serif" | "mono";
};

const DEFAULT_COLOR = "#6366f1";

const FONT_FAMILIES: Record<BrandingFormState["fontFamily"], string> = {
  sans: "'Inter', 'Helvetica Neue', ui-sans-serif, system-ui, sans-serif",
  serif: "'Playfair Display', 'Times New Roman', ui-serif, Georgia, serif",
  mono: "'JetBrains Mono', 'Courier New', ui-monospace, SFMono-Regular, monospace",
};

const FONT_LABELS: Record<BrandingFormState["fontFamily"], string> = {
  sans: "Sans (Modern)",
  serif: "Serif (Elegan)",
  mono: "Monospace (Teknis)",
};

const isValidHex = (value: string) => /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(value.trim());

const normaliseColor = (value: string) => {
  const trimmed = value.trim();
  return isValidHex(trimmed) ? trimmed : DEFAULT_COLOR;
};

type BrandingFormProps = {
  initialBranding: BrandingFormState;
};

export const BrandingForm = ({ initialBranding }: BrandingFormProps) => {
  const [state, setState] = useState<BrandingFormState>(initialBranding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const previewStyle = useMemo(() => {
    const color = normaliseColor(state.primaryColor);
    const fontFamily = FONT_FAMILIES[state.fontFamily];

    return {
      borderColor: color,
      fontFamily,
      accentColor: color,
    } as const;
  }, [state.primaryColor, state.fontFamily]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload = {
      logoUrl: state.logoUrl.trim() || null,
      primaryColor: state.primaryColor.trim() || null,
      fontFamily: state.fontFamily,
    } as const;

    try {
      const response = await fetch("/api/user/branding", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        const message = body?.error ?? "Gagal menyimpan branding. Periksa data Anda.";
        throw new Error(message);
      }

      const body = (await response.json().catch(() => null)) as
        | { data?: BrandingFormState }
        | null;

      if (body?.data) {
        setState({
          logoUrl: body.data.logoUrl ?? "",
          primaryColor: body.data.primaryColor ?? DEFAULT_COLOR,
          fontFamily: (body.data.fontFamily ?? "sans") as BrandingFormState["fontFamily"],
        });
      }

      setSuccess("Branding berhasil diperbarui. PDF terbaru akan menggunakan preferensi ini.");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Terjadi kesalahan tak terduga.";
      setError(message);
    } finally {
      setSaving(false);
    }
  };

  const pickerColor = normaliseColor(state.primaryColor);

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-6 rounded-2xl border border-border bg-background/80 p-6 shadow-lg shadow-black/20"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="logo-url" className="block text-sm font-medium text-foreground">
              Logo URL
            </label>
            <input
              id="logo-url"
              name="logoUrl"
              type="url"
              inputMode="url"
              value={state.logoUrl}
              onChange={(event) =>
                setState((previous) => ({ ...previous, logoUrl: event.target.value }))
              }
              placeholder="https://asset.brandmu/logo.png"
              className="w-full rounded-md border border-border bg-card/60 px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              aria-describedby="logo-url-help"
            />
            <p id="logo-url-help" className="text-xs text-muted-foreground">
              Gunakan tautan gambar yang di-host di layanan eksternal seperti Cloudinary atau CDN brand Anda.
              Aplikasi tidak menyimpan file biner secara langsung.
            </p>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground" htmlFor="primary-color">
              Warna utama
            </label>
            <div className="flex items-center gap-3">
              <input
                id="primary-color"
                type="color"
                value={pickerColor}
                onChange={(event) =>
                  setState((previous) => ({ ...previous, primaryColor: event.target.value }))
                }
                className="h-10 w-12 cursor-pointer rounded-md border border-border bg-transparent"
                aria-label="Pilih warna utama"
              />
              <input
                type="text"
                value={state.primaryColor}
                onChange={(event) =>
                  setState((previous) => ({ ...previous, primaryColor: event.target.value }))
                }
                placeholder="#6366F1"
                className="flex-1 rounded-md border border-border bg-card/60 px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              />
            </div>
            <p className="text-xs text-muted-foreground">Format warna hex, misal #1E3A8A.</p>
          </div>

          <div className="space-y-2">
            <label htmlFor="font-family" className="block text-sm font-medium text-foreground">
              Font
            </label>
            <select
              id="font-family"
              value={state.fontFamily}
              onChange={(event) =>
                setState((previous) => ({
                  ...previous,
                  fontFamily: event.target.value as BrandingFormState["fontFamily"],
                }))
              }
              className="w-full rounded-md border border-border bg-card/60 px-3 py-2 text-sm text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              {Object.entries(FONT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card/50 p-5">
          <div className="space-y-3">
            <p className="text-sm font-medium text-muted-foreground">Preview PDF</p>
            <div
              className="relative overflow-hidden rounded-lg border-2 bg-background/80 p-5 shadow-inner"
              style={{ borderColor: previewStyle.borderColor, fontFamily: previewStyle.fontFamily }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold" style={{ color: previewStyle.borderColor }}>
                    {state.logoUrl ? "Brand Anda" : "InvoSmart"}
                  </p>
                  <p className="text-xs text-muted-foreground">Invoice profesional siap kirim</p>
                </div>
                <span
                  className="rounded-md px-2 py-1 text-xs"
                  style={{ backgroundColor: `${previewStyle.borderColor}20`, color: previewStyle.borderColor }}
                >
                  INV-2024-001
                </span>
              </div>

              <div className="mt-4 space-y-1 text-xs text-foreground/80">
                <p>Klien: PT Kreatif</p>
                <p>Total: Rp 12.500.000</p>
                <p className="text-muted-foreground">Ditandatangani digital melalui InvoSmart</p>
              </div>

              <span className="absolute bottom-3 right-4 text-[10px] uppercase tracking-wider text-foreground/30">
                Watermark: InvoSmart
              </span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Preview hanya indikatif. Logo asli dan detail invoice Anda akan dirender otomatis saat export PDF.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3" aria-live="polite" role="status">
        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-70"
          disabled={saving}
        >
          {saving ? "Menyimpan..." : "Simpan"}
        </button>

        {success ? (
          <span className="rounded-md border border-emerald-600/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
            {success}
          </span>
        ) : null}

        {error ? (
          <span className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
};
