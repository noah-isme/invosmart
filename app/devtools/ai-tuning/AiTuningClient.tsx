"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import type { OptimizationLogEntry } from "@/lib/ai/optimizer";

import { applyRecommendationAction, rejectRecommendationAction } from "./actions";

type SerializableOptimizationLogEntry = Omit<OptimizationLogEntry, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type AiTuningClientProps = {
  initialRecommendations: SerializableOptimizationLogEntry[];
  history: SerializableOptimizationLogEntry[];
  actor: string;
};

const ConfidenceChart = dynamic(() => import("./AiTuningConfidenceChart").then((mod) => mod.AiTuningConfidenceChart), {
  ssr: false,
  loading: () => (
    <div className="flex h-64 w-full flex-col justify-center gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="h-40 w-full" />
    </div>
  ),
});

const statusBadgeClass: Record<OptimizationLogEntry["status"], string> = {
  PENDING: "bg-amber-500/15 text-amber-100 border border-amber-500/30",
  APPLIED: "bg-emerald-500/15 text-emerald-100 border border-emerald-500/30",
  REJECTED: "bg-rose-500/15 text-rose-100 border border-rose-500/30",
};

export default function AiTuningClient({ initialRecommendations, history, actor }: AiTuningClientProps) {
  const [recommendations, setRecommendations] = useState(initialRecommendations);
  const [isPending, startTransition] = useTransition();
  const { notify } = useToast();

  const pendingHistory = useMemo(() => history.filter((entry) => entry.status !== "PENDING"), [history]);

  const handleApply = (id: string) => {
    startTransition(async () => {
      try {
        const updated = await applyRecommendationAction(id, actor);
        setRecommendations((current) => current.filter((item) => item.id !== id));
        notify({
          title: "Optimasi diterapkan",
          description: `Rute ${updated.route} menggunakan rekomendasi terbaru.`,
          variant: "success",
        });
      } catch (error) {
        notify({
          title: "Gagal menerapkan rekomendasi",
          description: (error as Error).message,
          variant: "error",
        });
      }
    });
  };

  const handleReject = (id: string) => {
    startTransition(async () => {
      try {
        const updated = await rejectRecommendationAction(id, actor);
        setRecommendations((current) => current.filter((item) => item.id !== id));
        notify({
          title: "Rekomendasi ditolak",
          description: `Rute ${updated.route} ditandai untuk review manual.`,
        });
      } catch (error) {
        notify({
          title: "Gagal menolak rekomendasi",
          description: (error as Error).message,
          variant: "error",
        });
      }
    });
  };

  return (
    <section className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.36em] text-text/50">AI Optimizer</p>
            <h2 className="text-2xl font-semibold text-text">Rekomendasi aktif</h2>
            <p className="text-sm text-text/65">
              Analisis PostHog + Sentry dikurasi menjadi saran yang siap diterapkan. Pastikan perubahan selaras dengan strategi
              UI non-kritis.
            </p>
          </header>

          {recommendations.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-text/60">
              Semua rekomendasi terbaru telah diproses.
            </div>
          ) : (
            <ul className="space-y-4">
              {recommendations.map((item) => (
                <li key={item.id} className="rounded-2xl border border-white/15 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-text">{item.route}</p>
                      <p className="text-xs text-text/60">{item.impact}</p>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass[item.status]}`}>
                      Confidence {Math.round(item.confidence * 100)}%
                    </span>
                  </div>
                  <p className="mt-3 text-sm text-text/80">{item.suggestion}</p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button onClick={() => handleApply(item.id)} disabled={isPending}>
                      Apply otomatis
                    </Button>
                    <Button variant="ghost" onClick={() => handleReject(item.id)} disabled={isPending}>
                      Tolak
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <h2 className="text-xl font-semibold text-text">Confidence trend</h2>
          <ConfidenceChart history={history} />
        </div>
      </div>

      <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <header className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-text">Histori log</h3>
            <p className="text-xs text-text/60">Semua tindakan tercatat untuk audit internal.</p>
          </div>
        </header>
        {pendingHistory.length === 0 ? (
          <SkeletonText lines={4} />
        ) : (
          <div className="space-y-3">
            {pendingHistory.map((entry) => (
              <article key={entry.id} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-text">{entry.route}</p>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClass[entry.status]}`}>
                    {entry.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-text/75">{entry.suggestion}</p>
                <p className="mt-1 text-xs text-text/60">Impact: {entry.impact}</p>
                <p className="mt-1 text-xs text-text/50">
                  {new Date(entry.createdAt).toLocaleString()} • oleh {entry.actor}
                </p>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
