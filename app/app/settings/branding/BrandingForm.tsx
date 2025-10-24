"use client";

import { motion } from "framer-motion";
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

const labelClass =
  "text-[0.7rem] font-medium uppercase tracking-[0.32em] text-white/55";
const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E1016]";
const subtleText = "text-xs text-white/55";

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
      gradient: `linear-gradient(135deg, ${color}, rgba(34, 211, 238, 0.85))`,
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
      className="glass-surface relative overflow-hidden rounded-[30px] border border-white/5 p-8 shadow-[0_28px_70px_rgba(8,10,16,0.55)]"
    >
      <div className="absolute -left-12 top-10 h-40 w-40 rounded-full bg-[#22D3EE]/20 blur-3xl" aria-hidden />
      <div className="absolute -right-16 bottom-24 h-48 w-48 rounded-full bg-[#6366F1]/25 blur-[120px]" aria-hidden />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),minmax(0,0.9fr)]">
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

        <div className="flex flex-col justify-between gap-6">
          <div className="space-y-4">
            <p className="text-[0.7rem] uppercase tracking-[0.32em] text-white/50">Preview PDF real-time</p>
            <motion.div
              key={`${previewStyle.borderColor}-${previewStyle.fontFamily}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: "easeOut" }}
              className="relative overflow-hidden rounded-[22px] p-[1px]"
              style={{ background: previewStyle.gradient }}
            >
              <div
                className="relative rounded-[20px] border border-white/10 bg-[rgba(14,16,22,0.92)] p-6 shadow-[0_18px_50px_rgba(8,10,16,0.6)]"
                style={{ fontFamily: previewStyle.fontFamily }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xl font-semibold" style={{ color: previewStyle.borderColor }}>
                      {state.logoUrl ? "Brand Anda" : "InvoSmart"}
                    </p>
                    <p className="text-xs text-white/50">Invoice profesional siap kirim</p>
                  </div>
                  <span
                    className="rounded-full px-3 py-1 text-xs font-semibold"
                    style={{
                      backgroundColor: `${previewStyle.borderColor}1a`,
                      color: previewStyle.borderColor,
                    }}
                  >
                    INV-2024-001
                  </span>
                </div>

                <div className="mt-6 space-y-2 text-sm text-white/80">
                  <p>Klien: PT Kreatif</p>
                  <p>Total: Rp 12.500.000</p>
                  <p className="text-white/50">Ditandatangani digital melalui InvoSmart</p>
                </div>

                <motion.span
                  layout
                  className="absolute inset-x-0 bottom-0 flex h-12 items-center justify-end px-6 text-[10px] uppercase tracking-[0.4em] text-white/30"
                  style={{ color: previewStyle.borderColor, opacity: 0.35 }}
                >
                  Watermark · InvoSmart
                </motion.span>

                <motion.div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/5 via-transparent to-transparent"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 0.6 }}
                  transition={{ duration: 0.5, ease: "easeOut" }}
                />
              </div>
            </motion.div>
          </div>

          <p className={subtleText}>
            Preview bersifat ilustratif. Logo asli, skema warna, dan detail invoice akan dirender otomatis saat Anda mengunduh PDF.
          </p>
        </div>
      </div>

      <div className="mt-10 flex flex-wrap items-center gap-3" aria-live="polite" role="status">
        <motion.button
          type="submit"
          whileTap={{ scale: 0.96 }}
          className="gradient-button inline-flex items-center justify-center rounded-2xl px-5 py-2.5 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/80 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0E1016] disabled:cursor-not-allowed disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Menyimpan preferensi..." : "Simpan perubahan"}
        </motion.button>

        {success ? (
          <span className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-xs text-emerald-300 shadow-[0_10px_25px_rgba(16,185,129,0.15)]">
            {success}
          </span>
        ) : null}

        {error ? (
          <span className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-2 text-xs text-red-300 shadow-[0_10px_25px_rgba(239,68,68,0.2)]">
            {error}
          </span>
        ) : null}
      </div>
    </form>
  );
};
