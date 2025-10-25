"use client";

import { motion } from "framer-motion";
import { useMemo } from "react";

import { Button } from "@/components/ui/Button";
import { useTheme } from "@/context/ThemeContext";

type ThemeMode = "light" | "dark";

const formatHexLabel = (value: string) => value.toUpperCase();

const PreviewCard = ({ primary, accent, mode }: { primary: string; accent: string; mode: ThemeMode }) => {
  const cardKey = useMemo(() => `${primary}-${accent}-${mode}`, [accent, mode, primary]);

  return (
    <motion.div
      key={cardKey}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="glass-surface relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(var(--color-primary)_/_0.16),_transparent_60%)]" aria-hidden />
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

        <section className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-text/45">Revenue</p>
              <p className="text-base font-semibold text-text">Rp24.400.000</p>
            </div>
            <span className="rounded-full bg-primary/20 px-3 py-1 text-xs font-medium text-primary">
              +18%
            </span>
          </div>
          <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
            <motion.div
              key={`revenue-${cardKey}`}
              initial={{ width: "45%" }}
              animate={{ width: "78%" }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="h-full rounded-full bg-primary"
            />
          </div>
        </section>

        <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 md:grid-cols-2">
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

export const ThemeSettingsPanel = () => {
  const { primary, accent, mode, updateTheme, saveTheme, isLoading, isSaving } = useTheme();

  const handlePrimaryChange = (value: string) => {
    void updateTheme({ primary: value });
  };

  const handleAccentChange = (value: string) => {
    void updateTheme({ accent: value });
  };

  const handleModeChange = (value: ThemeMode) => {
    void updateTheme({ mode: value });
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

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-text/60">Perubahan otomatis disimpan di perangkat. Klik simpan untuk menyinkronkan ke akun.</p>
          <Button
            onClick={async () => {
              await saveTheme();
            }}
            disabled={isSaving}
          >
            Simpan Tema
          </Button>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-md">
        <PreviewCard primary={primary} accent={accent} mode={mode} />
      </section>
    </div>
  );
};
