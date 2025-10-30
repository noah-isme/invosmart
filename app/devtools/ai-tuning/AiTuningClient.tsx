"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/Button";
import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import type { OptimizationLogEntry } from "@/lib/ai/optimizer";
import type { ExplanationPayload } from "@/lib/ai/explain";

import { applyRecommendationAction, rejectRecommendationAction } from "./actions";

type SerializableOptimizationLogEntry = Omit<OptimizationLogEntry, "createdAt" | "updatedAt"> & {
  createdAt: string;
  updatedAt: string;
};

type SerializableExplanation = Omit<ExplanationPayload, "createdAt"> & {
  createdAt: string;
};

type AiTuningClientProps = {
  initialRecommendations: SerializableOptimizationLogEntry[];
  history: SerializableOptimizationLogEntry[];
  actor: string;
  explanations: Partial<Record<string, SerializableExplanation>>;
  trustScore: number;
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

const policyBadgeClass: Record<OptimizationLogEntry["policyStatus"], string> = {
  ALLOWED: "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30",
  REVIEW: "bg-amber-500/10 text-amber-200 border border-amber-500/30",
  BLOCKED: "bg-rose-500/10 text-rose-200 border border-rose-500/30",
};

const trustScoreIndicator = (score: number) => {
  if (score >= 85) return "bg-emerald-500/10 text-emerald-200 border border-emerald-500/30";
  if (score >= 70) return "bg-amber-500/10 text-amber-200 border border-amber-500/30";
  return "bg-rose-500/10 text-rose-200 border border-rose-500/30";
};

export default function AiTuningClient({ initialRecommendations, history, actor, explanations, trustScore }: AiTuningClientProps) {
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
      <div className="grid gap-4 md:grid-cols-3">
        <div className={`rounded-3xl border border-white/10 bg-white/[0.03] p-6 md:col-span-2`}>
          <p className="text-xs uppercase tracking-[0.42em] text-text/50">Governance signal</p>
          <h2 className="mt-2 text-3xl font-semibold text-text">Trust score {trustScore}</h2>
          <p className="mt-2 text-sm text-text/65">
            Skor dihitung dari tingkat keberhasilan rekomendasi, rollback otomatis, dan pelanggaran kebijakan aktif.
          </p>
        </div>
        <div className={`flex items-center justify-center rounded-3xl border border-white/10 bg-white/[0.03] p-6`}>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${trustScoreIndicator(trustScore)}`}>
            {trustScore >= 85 ? "Stabil" : trustScore >= 70 ? "Perlu diawasi" : "Butuh investigasi"}
          </span>
        </div>
      </div>

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
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-text/65">
                    <span className={`rounded-full px-3 py-1 font-semibold ${policyBadgeClass[item.policyStatus]}`}>
                      Kebijakan: {item.policyStatus}
                    </span>
                    {item.policyReason && <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1">{item.policyReason}</span>}
                  </div>
                  {(() => {
                    const explanation = explanations[item.id];
                    if (!explanation) {
                      return (
                        <p className="mt-3 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-3 text-xs text-text/60">
                          Penjelasan AI akan muncul setelah endpoint /api/ai/explain dipanggil atau audit dijalankan.
                        </p>
                      );
                    }

                    return (
                      <div className="mt-3 space-y-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs text-text/75">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="font-semibold text-text">Why</p>
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1">
                            Confidence {Math.round(explanation.confidence * 100)}%
                          </span>
                        </div>
                        <p className="text-sm text-text/80">{explanation.why}</p>
                        {explanation.context && <p className="text-[11px] text-text/60">{explanation.context}</p>}
                        <div>
                          <p className="text-[11px] uppercase tracking-[0.2em] text-text/50">Data basis</p>
                          <ul className="mt-1 space-y-1">
                            {explanation.dataBasis.map((itemBasis, index) => (
                              <li key={index} className="rounded border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px]">
                                {itemBasis}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    );
                  })()}
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
