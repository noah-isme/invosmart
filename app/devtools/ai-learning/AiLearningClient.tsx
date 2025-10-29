"use client";

import dynamic from "next/dynamic";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { useToast } from "@/context/ToastContext";
import type { LearningEvaluation } from "@/lib/ai/learning";

import { triggerLearningCycleAction } from "./actions";

type SerializableLearningProfile = {
  route: string;
  successRate: number;
  avgImpact: number;
  confidenceWeight: number;
  totalEvaluations: number;
  lastLcpP95: number;
  lastInpP95: number;
  lastApiLatencyP95: number;
  lastErrorRate: number;
  lastEval: string | null;
  createdAt: string;
  updatedAt: string;
};

type SerializableOptimizationLog = {
  id: string;
  route: string;
  change: string;
  impact: string;
  confidence: number;
  status: "PENDING" | "APPLIED" | "REJECTED";
  actor: string;
  notes: string | null;
  rollback: boolean;
  deltaImpact: number | null;
  evalConfidence: number | null;
  createdAt: string;
  updatedAt: string;
};

type AiLearningClientProps = {
  profiles: SerializableLearningProfile[];
  logs: SerializableOptimizationLog[];
  evaluations: LearningEvaluation[];
  insight: string | null;
};

const LearningCurveChart = dynamic(
  () => import("./AiLearningTrendChart").then((mod) => mod.AiLearningTrendChart),
  {
    ssr: false,
    loading: () => <div className="h-64 rounded-3xl border border-white/10 bg-white/[0.04]" />,
  },
);

const ConfidenceHistoryChart = dynamic(
  () =>
    import("./AiLearningConfidenceHistory").then((mod) => mod.AiLearningConfidenceHistory),
  {
    ssr: false,
    loading: () => <div className="h-64 rounded-3xl border border-white/10 bg-white/[0.04]" />,
  },
);

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

export default function AiLearningClient({ profiles, logs, evaluations, insight }: AiLearningClientProps) {
  const router = useRouter();
  const { notify } = useToast();
  const [latestInsight, setLatestInsight] = useState(insight ?? null);
  const [isPending, startTransition] = useTransition();

  const rollbackLogs = useMemo(
    () => logs.filter((log) => log.rollback).map((log) => ({ ...log, createdAt: new Date(log.createdAt) })),
    [logs],
  );

  const confidenceHistory = useMemo(
    () =>
      logs
        .filter((log) => typeof log.evalConfidence === "number")
        .map((log) => ({
          id: log.id,
          route: log.route,
          confidence: Number(log.evalConfidence ?? log.confidence),
          timestamp: new Date(log.updatedAt).toISOString(),
          rollback: log.rollback,
        }))
        .slice(0, 32)
        .reverse(),
    [logs],
  );

  const learningCurveData = useMemo(
    () =>
      profiles.map((profile) => ({
        route: profile.route,
        successRate: profile.successRate,
        avgImpact: profile.avgImpact,
        confidence: profile.confidenceWeight,
      })),
    [profiles],
  );

  const handleManualTrigger = () => {
    startTransition(async () => {
      try {
        const result = await triggerLearningCycleAction();
        setLatestInsight(result.insight ?? null);
        router.refresh();

        const hasRollback = result.evaluations.some((evaluation) => evaluation.rollbackTriggered);
        notify({
          title: hasRollback ? "Auto-rollback dijalankan" : "Evaluasi selesai",
          description: hasRollback
            ? "Salah satu rute mengalami regresi dan telah dipulihkan otomatis."
            : "Profil pembelajaran berhasil diperbarui.",
          variant: hasRollback ? "error" : "success",
        });
      } catch (error) {
        notify({
          title: "Evaluasi gagal",
          description: (error as Error).message,
          variant: "error",
        });
      }
    });
  };

  return (
    <section className="space-y-8">
      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.32em] text-text/50">Learning Loop</p>
              <h2 className="text-2xl font-semibold text-text">Learning curve & impact</h2>
            </div>
            <Button onClick={handleManualTrigger} disabled={isPending}>
              Re-evaluate sekarang
            </Button>
          </header>

          {learningCurveData.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-text/60">
              Belum ada data pembelajaran yang terekam.
            </div>
          ) : (
            <LearningCurveChart data={learningCurveData} />
          )}

          {latestInsight ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-text/80">
              <p className="text-xs uppercase tracking-[0.3em] text-text/45">Meta insight</p>
              <p className="mt-2 whitespace-pre-line leading-relaxed">{latestInsight}</p>
            </div>
          ) : (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 text-sm text-text/70">
              Insight AI belum tersedia — jalankan evaluasi manual untuk menghasilkan ringkasan terbaru.
            </div>
          )}
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.32em] text-text/50">Confidence trend</p>
            <h2 className="text-xl font-semibold text-text">Evaluasi terakhir</h2>
          </header>

          {confidenceHistory.length === 0 ? (
            <div className="flex h-48 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-text/60">
              Belum ada histori confidence.
            </div>
          ) : (
            <ConfidenceHistoryChart data={confidenceHistory} />
          )}

          <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
            <p className="text-xs uppercase tracking-[0.28em] text-text/45">Evaluations</p>
            <ul className="mt-3 space-y-2 text-sm text-text/75">
              {evaluations.map((evaluation) => (
                <li key={evaluation.route} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-text">{evaluation.route}</span>
                  <span>
                    Impact: {formatPercent(evaluation.compositeImpact)} · Confidence → {formatPercent(evaluation.newConfidence)}
                  </span>
                </li>
              ))}
              {evaluations.length === 0 && (
                <li className="text-text/55">Belum ada evaluasi aktif untuk interval ini.</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.32em] text-text/50">Rollback log</p>
            <h2 className="text-xl font-semibold text-text">Riwayat auto-rollback</h2>
          </header>

          {rollbackLogs.length === 0 ? (
            <div className="flex h-32 flex-col items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] text-sm text-text/60">
              Belum ada rollback otomatis.
            </div>
          ) : (
            <ul className="space-y-3">
              {rollbackLogs.map((log) => (
                <li key={log.id} className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-50">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{log.route}</span>
                    <span className="text-xs">{log.createdAt.toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs text-amber-100/90">{log.change}</p>
                  <p className="mt-1 text-xs text-amber-100/90">Delta impact: {formatPercent(log.deltaImpact ?? 0)}</p>
                  <p className="mt-2 text-xs text-amber-100/80">{log.notes ?? "Rollback otomatis"}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <header className="space-y-2">
            <p className="text-xs uppercase tracking-[0.32em] text-text/50">Route insight</p>
            <h2 className="text-xl font-semibold text-text">Snapshot profil</h2>
          </header>

          {profiles.length === 0 ? (
            <Skeleton className="h-48 w-full" />
          ) : (
            <ul className="space-y-3 text-sm text-text/75">
              {profiles.slice(0, 8).map((profile) => (
                <li key={profile.route} className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-text">{profile.route}</span>
                    <span className="text-xs text-text/55">
                      Evaluasi: {profile.totalEvaluations} · Confidence: {formatPercent(profile.confidenceWeight)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text/60">Success rate: {formatPercent(profile.successRate)}</p>
                  <p className="mt-1 text-xs text-text/60">Avg impact: {formatPercent(profile.avgImpact)}</p>
                  <p className="mt-1 text-xs text-text/50">
                    Terakhir evaluasi: {profile.lastEval ? new Date(profile.lastEval).toLocaleString() : "Belum pernah"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
