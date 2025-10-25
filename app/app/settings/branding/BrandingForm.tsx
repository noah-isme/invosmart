"use client";

import { type FormEvent, type MouseEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";

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

const hexToRgb = (hex: string) => {
  const normalized = normaliseColor(hex).replace("#", "");
  const chunk = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const bigint = parseInt(chunk, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255,
  };
};

const relativeLuminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const getAccessibleTextColor = (hex: string) => {
  const luminance = relativeLuminance(hexToRgb(hex));
  return luminance > 0.5 ? "#111827" : "#F9FAFB";
};

type BrandingFormProps = {
  initialBranding: BrandingFormState;
};

const labelClass = "text-[0.7rem] font-medium uppercase tracking-[0.32em] text-text/55";
const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const subtleText = "text-xs text-text/55";

export const BrandingForm = ({ initialBranding }: BrandingFormProps) => {
  const [state, setState] = useState<BrandingFormState>(initialBranding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewAnimating, setPreviewAnimating] = useState(false);

  const accentColor = useMemo(() => normaliseColor(state.primaryColor), [state.primaryColor]);
  const fontFamily = useMemo(() => FONT_FAMILIES[state.fontFamily], [state.fontFamily]);
  const accentTextColor = useMemo(() => getAccessibleTextColor(accentColor), [accentColor]);
  const accentTint = useMemo(() => {
    const { r, g, b } = hexToRgb(accentColor);
    return `rgba(${r}, ${g}, ${b}, 0.12)`;
  }, [accentColor]);
  const accentLuminance = useMemo(() => relativeLuminance(hexToRgb(accentColor)), [accentColor]);
  const headingColor = accentLuminance < 0.25 ? "#F9FAFB" : accentColor;
  const statusTextColor = accentLuminance < 0.35 ? "#F9FAFB" : accentColor;

  useEffect(() => {
    setPreviewAnimating(true);
    const timeout = window.setTimeout(() => {
      setPreviewAnimating(false);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [accentColor]);

  const handleSubmit = async (
    event?: FormEvent<HTMLFormElement> | MouseEvent<HTMLButtonElement>,
  ) => {
    if (event) {
      event.preventDefault();
    }

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
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
      <form
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_24px_rgba(0,0,0,0.25)] backdrop-blur-md"
      >
        <div className="space-y-6">
          <div className="space-y-3">
            <label htmlFor="logo-url" className={labelClass}>
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
              className={inputClass}
              aria-describedby="logo-url-help"
            />
            <p id="logo-url-help" className={subtleText}>
              Gunakan tautan gambar yang di-host di layanan eksternal seperti Cloudinary atau CDN brand Anda. Aplikasi tidak
              menyimpan file biner secara langsung.
            </p>
          </div>

          <div className="space-y-3">
            <label className={labelClass} htmlFor="primary-color">
              Warna utama
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id="primary-color"
                type="color"
                value={pickerColor}
                onChange={(event) =>
                  setState((previous) => ({ ...previous, primaryColor: event.target.value }))
                }
                className="h-12 w-16 cursor-pointer rounded-2xl border border-white/10 bg-transparent shadow-[0_8px_30px_rgba(8,10,16,0.4)]"
                aria-label="Pilih warna utama"
              />
              <input
                type="text"
                value={state.primaryColor}
                onChange={(event) =>
                  setState((previous) => ({ ...previous, primaryColor: event.target.value }))
                }
                placeholder="#6366F1"
                className={inputClass}
              />
            </div>
            <p className={subtleText}>Format warna hex, misalnya #1E3A8A.</p>
          </div>

          <div className="space-y-3">
            <label htmlFor="font-family" className={labelClass}>
              Font utama PDF
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
              className={inputClass}
            >
              {Object.entries(FONT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3" aria-live="polite" role="status">
          <Button
            type="submit"
            onClick={(event) => handleSubmit(event)}
            disabled={saving}
            className="px-6"
          >
            {saving ? "Menyimpan preferensi..." : "Simpan perubahan"}
          </Button>

          {success ? (
            <span className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-200 shadow-[0_10px_25px_rgba(16,185,129,0.18)]">
              {success}
            </span>
          ) : null}

          {error ? (
            <span className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-200 shadow-[0_10px_25px_rgba(239,68,68,0.22)]">
              {error}
            </span>
          ) : null}
        </div>
      </form>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_24px_rgba(0,0,0,0.25)] backdrop-blur-md">
        <div
          className={`transform rounded-xl border border-indigo-400/30 bg-bg/80 p-5 shadow-[0_0_24px_rgba(var(--color-primary)_/_0.25)] transition-all duration-300 ease-out ${
            previewAnimating ? "scale-[0.98] opacity-90" : "scale-100 opacity-100"
          }`}
          style={{ borderColor: accentColor, fontFamily }}
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xl font-semibold" style={{ color: headingColor }}>
                {state.logoUrl ? "Brand Anda" : "InvoSmart"}
              </p>
              <p className="text-xs text-text/60">Invoice profesional siap kirim</p>
            </div>
            <span
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{ backgroundColor: accentTint, color: accentTextColor }}
            >
              INV-2024-001
            </span>
          </div>

          <div className="mt-6 space-y-2 text-sm text-text/80">
            <p>Klien: PT Kreatif</p>
            <p>Total: Rp 12.500.000</p>
            <p className="text-text/50">Ditandatangani digital melalui InvoSmart</p>
          </div>

          <div
            className="mt-8 flex items-center justify-between rounded-xl bg-white/[0.02] px-4 py-3 text-[11px] uppercase tracking-[0.32em] text-text/35"
            style={{ border: `1px solid ${accentTint}` }}
          >
            <span>Watermark · InvoSmart</span>
            <span style={{ color: statusTextColor }}>Paid</span>
          </div>
        </div>

        <p className="mt-4 text-sm text-text/60">
          Preview indikatif. Detail aktual dirender saat export PDF.
        </p>
      </section>
    </div>
  );
};
