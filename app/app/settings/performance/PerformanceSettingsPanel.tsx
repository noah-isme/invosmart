"use client";

import { useCallback, useMemo } from "react";

import { Button } from "@/components/ui/Button";
import { useAiOptimizer } from "@/context/AiOptimizerContext";

export function PerformanceSettingsPanel() {
  const {
    predictivePrefetchEnabled,
    setPredictivePrefetchEnabled,
    recommendations,
    refreshRecommendations,
    isLoading,
    featureEnabled,
  } = useAiOptimizer();

  const toggle = useCallback(() => {
    setPredictivePrefetchEnabled(!predictivePrefetchEnabled);
  }, [predictivePrefetchEnabled, setPredictivePrefetchEnabled]);

  const statusLabel = useMemo(() => {
    if (!featureEnabled) return "Dinonaktifkan via konfigurasi";
    return predictivePrefetchEnabled ? "Aktif" : "Nonaktif";
  }, [featureEnabled, predictivePrefetchEnabled]);

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-text">Predictive Prefetch</h2>
            <p className="text-sm text-text/60">
              Prefetch halaman dengan confidence ≥ 70% ketika thread utama idle. Membantu percepat navigasi tanpa menambah LCP
              awal.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={predictivePrefetchEnabled && featureEnabled}
            onClick={toggle}
            disabled={!featureEnabled}
            className={`relative inline-flex h-10 w-20 items-center rounded-full border border-white/15 px-1 transition-colors ${
              predictivePrefetchEnabled && featureEnabled ? "bg-primary/80" : "bg-white/10"
            } ${featureEnabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
          >
            <span
              className={`inline-block h-8 w-8 transform rounded-full bg-white transition ${
                predictivePrefetchEnabled && featureEnabled ? "translate-x-10" : "translate-x-0"
              }`}
            />
          </button>
        </header>
        <dl className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <dt className="text-xs uppercase tracking-[0.3em] text-text/50">Status</dt>
            <dd className="mt-2 text-lg font-semibold text-text">{statusLabel}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <dt className="text-xs uppercase tracking-[0.3em] text-text/50">Antrian rekomendasi</dt>
            <dd className="mt-2 text-lg font-semibold text-text">{recommendations.length}</dd>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <dt className="text-xs uppercase tracking-[0.3em] text-text/50">Mode</dt>
            <dd className="mt-2 text-sm text-text/70">
              Prefetch berjalan otomatis saat browser idle dan mematuhi guardrails AI.
            </dd>
          </div>
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={() => refreshRecommendations()} disabled={isLoading || !featureEnabled}>
            {isLoading ? "Sinkronisasi..." : "Sinkronkan rekomendasi"}
          </Button>
          <p className="text-xs text-text/50">
            Riwayat prefetch tersimpan secara lokal dan dapat direset dengan menonaktifkan fitur sementara.
          </p>
        </div>
      </div>
    </section>
  );
}
