import { ExperimentAxis, ExperimentStatus } from "@prisma/client";
import Link from "next/link";

const axisLabel: Record<ExperimentAxis, string> = {
  HOOK: "Hook",
  CAPTION: "Caption",
  CTA: "CTA",
  SCHEDULE: "Schedule",
};

const statusLabel: Record<ExperimentStatus, string> = {
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
  completed: "Completed",
};

type SerializableVariant = {
  id: number;
  variantKey: string;
  payload: unknown;
  performance: {
    impressions: number;
    clicks: number;
    conversions: number;
    dwellMs: number;
  };
  engagement: {
    score: number;
    ctr: number;
    conversionRate: number;
    averageDwellMs: number;
  };
  uplift: number;
  pValue: number;
  totalSample: number;
  isWinner: boolean;
};

type SerializableExperiment = {
  experiment: {
    id: number;
    contentId: number;
    axis: ExperimentAxis;
    status: ExperimentStatus;
    startAt: string;
    endAt: string | Date | null;
    createdAt: string;
    updatedAt: string;
  };
  variants: SerializableVariant[];
  baselineVariantId: number | null;
  winnerVariantId: number | null;
};

type ExperimentTableProps = {
  experiments: SerializableExperiment[];
  axisFilter?: ExperimentAxis;
  statusFilter?: ExperimentStatus;
};

const formatPercentage = (value: number) => `${(value * 100).toFixed(1)}%`;

const resolveVariantLabel = (variant?: SerializableVariant) => {
  if (!variant) return "Varian";
  const payload =
    variant.payload && typeof variant.payload === "object" ? (variant.payload as Record<string, unknown>) : {};

  if (typeof payload.hook === "string" && payload.hook) return payload.hook;
  if (typeof payload.caption === "string" && payload.caption) return payload.caption;
  if (typeof payload.cta === "string" && payload.cta) return payload.cta;
  return variant.variantKey;
};

export function ExperimentTable({ experiments, axisFilter, statusFilter }: ExperimentTableProps) {
  if (!experiments.length) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-white/70">
        Tidak ada eksperimen aktif. Mulai eksperimen baru untuk melihat performa varian.
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-6 py-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Eksperimen Terbaru</h2>
          <p className="text-xs text-white/60">
            Filter: Axis {axisFilter ? axisLabel[axisFilter] : "Semua"} • Status {statusFilter ? statusLabel[statusFilter] : "Semua"}
          </p>
        </div>
      </header>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-sm text-white/80">
          <thead className="bg-white/10 text-xs uppercase text-white/60">
            <tr>
              <th className="px-6 py-3">Konten</th>
              <th className="px-6 py-3">Axis</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Varian</th>
              <th className="px-6 py-3">Pemenang</th>
              <th className="px-6 py-3">CTR</th>
              <th className="px-6 py-3">Uplift</th>
              <th className="px-6 py-3">Detail</th>
            </tr>
          </thead>
          <tbody>
            {experiments.map((experiment) => {
              const winner = experiment.variants.find((variant) => variant.id === experiment.winnerVariantId) ?? experiment.variants[0];
              const ctr = winner?.performance.impressions
                ? winner.performance.clicks / winner.performance.impressions
                : 0;
              const winnerLabel = resolveVariantLabel(winner);
              return (
                <tr key={experiment.experiment.id} className="border-t border-white/10">
                  <td className="px-6 py-3">
                    <div className="flex flex-col">
                      <span className="font-medium text-white">Content #{experiment.experiment.contentId}</span>
                      <span className="text-xs text-white/50">
                        Start {new Date(experiment.experiment.startAt).toLocaleString("id-ID", { hour12: false })}
                      </span>
                    </div>
                  </td>
                  <td className="px-6 py-3">{axisLabel[experiment.experiment.axis]}</td>
                  <td className="px-6 py-3">
                    <span className="rounded-full border border-white/20 px-2 py-1 text-xs">
                      {statusLabel[experiment.experiment.status]}
                    </span>
                  </td>
                  <td className="px-6 py-3">{experiment.variants.length}</td>
                  <td className="px-6 py-3 max-w-[220px] truncate" title={winnerLabel}>
                    {winnerLabel}
                  </td>
                  <td className="px-6 py-3">{formatPercentage(ctr)}</td>
                  <td className="px-6 py-3">
                    {winner?.uplift ? `${(winner.uplift * 100).toFixed(1)}%` : "–"}
                  </td>
                  <td className="px-6 py-3">
                    <Link
                      href={`/app/admin/experiments/${experiment.experiment.id}`}
                      className="rounded-full border border-white/20 px-3 py-1 text-xs text-white/80 hover:border-white/40 hover:text-white"
                    >
                      Lihat
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
