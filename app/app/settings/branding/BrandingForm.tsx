"use client";

import { type FormEvent, type MouseEvent, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import { useTheme } from "@/context/ThemeContext";

type BrandingFormState = {
  logoUrl: string;
  primaryColor: string;
  fontFamily: "sans" | "serif" | "mono";
  syncWithTheme: boolean;
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

const formatHexLabel = (value: string) => normaliseColor(value).toUpperCase();

type BrandingFormProps = {
  initialBranding: BrandingFormState;
};

const labelClass = "text-[0.7rem] font-medium uppercase tracking-[0.32em] text-text/55";
const inputClass =
  "w-full rounded-2xl border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg";
const subtleText = "text-xs text-text/55";

export const BrandingForm = ({ initialBranding }: BrandingFormProps) => {
  const { primary: themePrimary } = useTheme();
  const [state, setState] = useState<BrandingFormState>(initialBranding);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [previewAnimating, setPreviewAnimating] = useState(false);

  const effectivePrimary = state.syncWithTheme ? themePrimary : state.primaryColor;
  const accentColor = useMemo(() => normaliseColor(effectivePrimary), [effectivePrimary]);
  const fontFamily = useMemo(() => FONT_FAMILIES[state.fontFamily], [state.fontFamily]);
  const accentTextColor = useMemo(() => getAccessibleTextColor(accentColor), [accentColor]);
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
      primaryColor: (state.syncWithTheme ? themePrimary : state.primaryColor).trim() || null,
      fontFamily: state.fontFamily,
      syncWithTheme: state.syncWithTheme,
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
        | {
            data?: {
              logoUrl: string | null;
              primaryColor: string | null;
              fontFamily: string | null;
              brandingSyncWithTheme?: boolean | null;
            };
          }
        | null;

      if (body?.data) {
        setState({
          logoUrl: body.data.logoUrl ?? "",
          primaryColor: body.data.primaryColor ?? DEFAULT_COLOR,
          fontFamily: (body.data.fontFamily ?? "sans") as BrandingFormState["fontFamily"],
          syncWithTheme: Boolean(body.data.brandingSyncWithTheme),
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

  const pickerColor = normaliseColor(effectivePrimary);

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
            <p className={labelClass}>Sinkronisasi warna</p>
            <button
              type="button"
              role="switch"
              aria-checked={state.syncWithTheme}
              onClick={() =>
                setState((previous) => ({
                  ...previous,
                  syncWithTheme: !previous.syncWithTheme,
                }))
              }
              className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left text-sm transition ${
                state.syncWithTheme
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-white/10 bg-white/0 text-text"
              } focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg`}
            >
              <span className="max-w-[80%] font-medium">
                Gunakan warna tema sebagai warna branding
              </span>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${
                  state.syncWithTheme ? "bg-primary/80" : "bg-white/20"
                }`}
                aria-hidden
              >
                <span
                  className={`size-5 rounded-full bg-white shadow transition ${
                    state.syncWithTheme ? "translate-x-5" : "translate-x-1"
                  }`}
                />
              </span>
            </button>
            <p className={subtleText}>
              Saat aktif, warna branding akan mengikuti tema aplikasi (saat ini {formatHexLabel(themePrimary)}).
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
                disabled={state.syncWithTheme}
              />
              <input
                type="text"
                value={state.syncWithTheme ? formatHexLabel(themePrimary) : state.primaryColor}
                onChange={(event) =>
                  setState((previous) => ({ ...previous, primaryColor: event.target.value }))
                }
                placeholder="#6366F1"
                className={inputClass}
                disabled={state.syncWithTheme}
              />
            </div>
            <p className={subtleText}>
              {state.syncWithTheme
                ? "Warna mengikuti tema Anda dan akan diperbarui otomatis ketika tema berubah."
                : "Format warna hex, misalnya #1E3A8A."}
            </p>
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

          <div className="space-y-3">
            {error ? (
              <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-100">
                {error}
              </div>
            ) : null}
            {success ? (
              <div className="rounded-xl border border-emerald-400/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                {success}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            onClick={(event) => {
              void handleSubmit(event);
            }}
            disabled={saving}
          >
            Simpan perubahan
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={(event) => {
              void handleSubmit(event);
            }}
            disabled={saving}
          >
            Simpan & tetap di halaman
          </Button>
        </div>
      </form>

      <aside
        className={`rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_24px_rgba(0,0,0,0.18)] backdrop-blur-md ${
          previewAnimating ? "scale-[1.01] transition-transform duration-300" : ""
        }`}
        style={{ fontFamily }}
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <div
              className="flex size-12 items-center justify-center rounded-2xl text-base font-semibold"
              style={{ backgroundColor: accentColor, color: accentTextColor }}
            >
              {state.logoUrl ? "BR" : "IV"}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-text/55">Invoice Preview</p>
              <p className="text-base font-semibold" style={{ color: headingColor }}>
                {state.logoUrl ? "Brand Anda" : "InvoSmart"}
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/0 p-4">
            <p className="text-xs uppercase tracking-[0.32em] text-text/45">Primary Color</p>
            <div className="mt-2 flex items-center gap-3">
              <span
                className="inline-flex size-10 items-center justify-center rounded-xl text-sm font-semibold"
                style={{ backgroundColor: accentColor, color: accentTextColor }}
              >
                {formatHexLabel(accentColor)}
              </span>
              <div>
                <p className="text-sm text-text/70">Digunakan untuk heading dan tombol utama.</p>
                <p className="text-xs text-text/55">
                  {state.syncWithTheme
                    ? "Mengikuti tema aplikasi untuk konsistensi visual."
                    : "Dapat diubah sesuai warna brand Anda."}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-white/10 bg-white/0 p-4">
            <p className="text-xs uppercase tracking-[0.32em] text-text/45">Tipografi</p>
            <p className="text-base font-semibold" style={{ color: headingColor }}>
              {FONT_LABELS[state.fontFamily]}
            </p>
            <p className="text-sm text-text/60">
              Menyentuh tone {state.fontFamily === "serif" ? "elegan" : state.fontFamily === "mono" ? "teknologi" : "modern"}.
            </p>
            <p className="text-xs text-text/55" style={{ color: statusTextColor }}>
              {state.syncWithTheme
                ? "Mode sinkronisasi aktif — branding mengikuti warna tema."
                : "Anda dapat menyesuaikan warna dan font secara manual."}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
};
