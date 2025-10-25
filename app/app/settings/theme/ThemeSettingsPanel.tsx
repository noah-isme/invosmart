"use client";

import { motion } from "framer-motion";
import { useCallback, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { DEFAULT_THEME, useTheme } from "@/context/ThemeContext";

type ThemeMode = "light" | "dark";

type ThemeSettingsPanelProps = {
  initialBrandingSync: boolean;
};

const PRESET_THEMES = [
  { name: "Oceanic", primary: "#0EA5E9", accent: "#22D3EE" },
  { name: "Amethyst", primary: "#8B5CF6", accent: "#EC4899" },
  { name: "Sunset", primary: "#F59E0B", accent: "#EF4444" },
  { name: "Emerald", primary: "#10B981", accent: "#14B8A6" },
] as const;

const formatHexLabel = (value: string) => value.toUpperCase();

const cardClassNames = (mode: ThemeMode) =>
  mode === "dark"
    ? "glass-surface relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-slate-950/60 to-slate-900/40 p-6 shadow-[0_0_30px_rgba(8,10,26,0.55)]"
    : "relative overflow-hidden rounded-2xl border border-accent/30 bg-white/90 p-6 shadow-[0_20px_45px_rgba(148,163,184,0.32)] backdrop-blur-xl";

export const PreviewCard = ({ primary, accent, mode }: { primary: string; accent: string; mode: ThemeMode }) => {
  const cardKey = useMemo(() => `${primary}-${accent}-${mode}`, [accent, mode, primary]);

  return (
    <motion.div
      key={cardKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={cardClassNames(mode)}
    >
      <div
        className={
          mode === "dark"
            ? "absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.3),_transparent_70%)]"
            : "absolute inset-0 bg-[linear-gradient(140deg,_rgba(var(--color-primary)_/_0.12),_transparent_40%),linear-gradient(220deg,_rgba(var(--color-accent)_/_0.12),_transparent_55%)]"
        }
        aria-hidden
      />
      <div className="relative flex flex-col gap-6">
        <header className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.38em] text-text/45">Live preview</p>
            <h3 className="mt-2 text-lg font-semibold text-text">Dashboard personal</h3>
            <p className="mt-1 text-sm text-text/60">
              Semua komponen menggunakan palet warna terbaru secara otomatis.
            </p>
          </div>
          <span className="inline-flex size-12 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-accent text-sm font-semibold text-text shadow-accent-glow">
            {mode === "dark" ? "🌙" : "☀️"}
          </span>
        </header>

        <section
          className={
            mode === "dark"
              ? "space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_18px_48px_rgba(8,10,16,0.45)]"
              : "space-y-3 rounded-2xl border border-primary/20 bg-white/60 p-4 shadow-[0_12px_35px_rgba(148,163,184,0.28)]"
          }
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-text/45">Revenue</p>
              <p className="text-base font-semibold text-text">Rp24.400.000</p>
            </div>
            <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-medium text-primary">+18%</span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/15">
            <motion.div
              key={`revenue-${cardKey}`}
              initial={{ width: "45%" }}
              animate={{ width: "78%" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-primary"
            />
          </div>
        </section>

        <section
          className={
            mode === "dark"
              ? "grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_14px_38px_rgba(8,10,16,0.38)] md:grid-cols-2"
              : "grid gap-3 rounded-2xl border border-primary/20 bg-white/70 p-4 shadow-[0_16px_40px_rgba(148,163,184,0.25)] md:grid-cols-2"
          }
        >
          <div>
            <p className="text-xs uppercase tracking-[0.32em] text-text/45">Paid invoices</p>
            <p className="mt-1 text-lg font-semibold text-text">32 dokumen</p>
            <p className="text-xs text-text/60">Tepat waktu 92%</p>
          </div>
          <div className="flex flex-col items-start gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
            <p className="text-xs uppercase tracking-[0.32em] text-text/45">Quick actions</p>
            <button className="gradient-button inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-medium text-text shadow-primary-glow">
              Buat invoice
            </button>
            <button className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/0 px-3 py-1.5 text-xs font-medium text-text/80 transition hover:border-white/20 hover:text-text">
              Kirim pengingat
            </button>
          </div>
        </section>
      </div>
    </motion.div>
  );
};

export const ThemeSettingsPanel = ({ initialBrandingSync }: ThemeSettingsPanelProps) => {
  const brandingSyncRef = useRef(initialBrandingSync);
  const { primary, accent, mode, updateTheme, saveTheme, resetTheme, isLoading, isSaving } = useTheme();
  const [hasPendingChanges, setHasPendingChanges] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const syncBrandingWithTheme = useCallback(
    async (color: string) => {
      if (!brandingSyncRef.current) {
        return;
      }

      try {
        await fetch("/api/user/branding", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ primaryColor: color }),
        });
      } catch {
        // Ignore sync failures to keep theme updates responsive.
      }
    },
    [],
  );

  const clearMessages = () => {
    setStatus(null);
    setError(null);
  };

  const handlePrimaryChange = (value: string) => {
    clearMessages();
    setHasPendingChanges(true);
    void updateTheme({ primary: value });
  };

  const handleAccentChange = (value: string) => {
    clearMessages();
    setHasPendingChanges(true);
    void updateTheme({ accent: value });
  };

  const handleModeChange = (value: ThemeMode) => {
    clearMessages();
    setHasPendingChanges(true);
    void updateTheme({ mode: value });
  };

  const handlePresetSelect = (preset: (typeof PRESET_THEMES)[number]) => {
    clearMessages();
    setHasPendingChanges(true);
    void updateTheme({ primary: preset.primary, accent: preset.accent });
  };

  const handleSave = async () => {
    clearMessages();
    try {
      await saveTheme();
      await syncBrandingWithTheme(primary);
      setStatus("Tema berhasil disimpan.");
      setHasPendingChanges(false);
    } catch {
      setError("Gagal menyimpan tema. Coba lagi.");
    }
  };

  const handleReset = async () => {
    clearMessages();
    try {
      await resetTheme();
      await syncBrandingWithTheme(DEFAULT_THEME.primary);
      setStatus("Tema berhasil direset ke default.");
      setHasPendingChanges(false);
    } catch {
      setError("Tidak dapat mereset tema saat ini.");
    }
  };

  if (isLoading) {
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6">
          <div className="h-6 w-32 animate-pulse rounded bg-white/10" />
          <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-6 w-24 animate-pulse rounded bg-white/10" />
        </div>
        <div className="h-[360px] animate-pulse rounded-2xl border border-white/10 bg-white/5" />
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="space-y-6 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <header>
          <h2 className="text-lg font-semibold text-text">Theme Settings</h2>
          <p className="mt-2 text-sm text-text/65">
            Pilih warna utama & aksen, lalu tentukan mode tampilan sesuai preferensi Anda. Perubahan langsung diterapkan pada UI.
          </p>
        </header>

        <div className="space-y-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.32em] text-text/45">Preset cepat</p>
            <div className="grid grid-cols-2 gap-3 pt-3 sm:grid-cols-4">
              {PRESET_THEMES.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => handlePresetSelect(preset)}
                  style={{
                    background: `linear-gradient(45deg, ${preset.primary}, ${preset.accent})`,
                  }}
                  className="h-12 rounded-xl shadow-[0_0_16px_rgba(0,0,0,0.35)] transition-transform duration-200 ease-out hover:scale-[1.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-bg focus-visible:ring-primary/60"
                  aria-label={`Apply ${preset.name} theme`}
                />
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text/70" htmlFor="theme-primary">
              Primary color
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                id="theme-primary"
                type="color"
                value={primary}
                onChange={(event) => handlePrimaryChange(event.target.value)}
                className="h-12 w-16 cursor-pointer rounded-2xl border border-white/10 bg-transparent shadow-[0_8px_30px_rgba(var(--color-primary)_/_0.32)]"
                aria-label="Pilih warna utama"
              />
              <span className="text-sm font-mono text-text/70">{formatHexLabel(primary)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text/70" htmlFor="theme-accent">
              Accent color
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                id="theme-accent"
                type="color"
                value={accent}
                onChange={(event) => handleAccentChange(event.target.value)}
                className="h-12 w-16 cursor-pointer rounded-2xl border border-white/10 bg-transparent shadow-[0_8px_30px_rgba(var(--color-accent)_/_0.32)]"
                aria-label="Pilih warna aksen"
              />
              <span className="text-sm font-mono text-text/70">{formatHexLabel(accent)}</span>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text/70" htmlFor="theme-mode">
              Mode tampilan
            </label>
            <select
              id="theme-mode"
              value={mode}
              onChange={(event) => handleModeChange(event.target.value as ThemeMode)}
              className="mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-sm text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-text/60">Perubahan otomatis disimpan di perangkat. Klik simpan untuk menyinkronkan ke akun.</p>
          {status ? <p className="text-xs font-medium text-emerald-300">{status}</p> : null}
          {error ? <p className="text-xs font-medium text-rose-300">{error}</p> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={isSaving || !hasPendingChanges}>
              Simpan Tema
            </Button>
            <Button variant="ghost" onClick={handleReset} disabled={isSaving}>
              Reset ke Tema Default
            </Button>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <PreviewCard primary={primary} accent={accent} mode={mode} />
      </section>
    </div>
  );
};
