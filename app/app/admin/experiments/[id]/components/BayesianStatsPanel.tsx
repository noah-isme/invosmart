import { getFlag } from "@/lib/feature-flags";
import { computeBayesianABStats, type BayesianABResult } from "@/lib/ai/bayesian-ab";

const formatPercent = (val: number) => `${(val * 100).toFixed(1)}%`;
const formatNumber = (val: number) => val.toLocaleString("id-ID");

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
  isWinner: boolean;
};

type SerializableExperiment = {
  variants: SerializableVariant[];
  baselineVariantId: number | null;
  winnerVariantId: number | null;
};

type BayesianStatsPanelProps = {
  experiment: SerializableExperiment;
};

export async function BayesianStatsPanel({ experiment }: BayesianStatsPanelProps) {
  // R5 Feature flag check
  const isEnabled = await getFlag("bayesian_ab_overlay");
  if (!isEnabled) {
    return null;
  }

  const samples = experiment.variants.map((v) => ({
    id: v.id,
    name: v.variantKey,
    impressions: v.performance.impressions,
    conversions: v.performance.conversions,
  }));

  const stats: BayesianABResult = computeBayesianABStats(samples);

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden">
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Analisis Bayesian A/B</h2>
          <p className="text-xs text-white/60 mt-0.5">
            Model Beta-Binomial Conjugate Posterior • 95% Credible Interval • Expected Loss
          </p>
        </div>
        <div className="flex items-center gap-2">
          {stats.isStatisticallySignificant ? (
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-medium text-emerald-400 border border-emerald-500/30">
              Signifikan Secara Statistik
            </span>
          ) : (
            <span className="rounded-full bg-amber-500/20 px-3 py-1 text-xs font-medium text-amber-400 border border-amber-500/30">
              {stats.recommendedAction === "continue" ? "Mengumpulkan Data" : "Inconclusive"}
            </span>
          )}
        </div>
      </header>

      <div className="p-6 flex flex-col gap-6">
        {/* Ringkasan & Rekomendasi */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-white/80 leading-relaxed">
          <span className="font-semibold text-white">Ringkasan Analyst: </span>
          {stats.summary}
        </div>

        {/* Overview Metric Cards */}
        {stats.probBBeatsA !== undefined && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-1">
              <span className="text-xs text-white/60 font-medium">Probabilitas P(B &gt; A)</span>
              <span className="text-2xl font-bold text-white">
                {formatPercent(stats.probBBeatsA)}
              </span>
              <div className="w-full bg-white/10 rounded-full h-1.5 mt-2">
                <div
                  className="bg-emerald-400 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, stats.probBBeatsA * 100))}%` }}
                />
              </div>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-1">
              <span className="text-xs text-white/60 font-medium">Expected Loss (B)</span>
              <span className="text-2xl font-bold font-mono text-emerald-400">
                {stats.expectedLossB !== undefined ? formatPercent(stats.expectedLossB) : "—"}
              </span>
              <span className="text-[11px] text-white/40">Resiko konversi hilang jika memilih B</span>
            </div>

            <div className="rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-1">
              <span className="text-xs text-white/60 font-medium">Expected Loss (A)</span>
              <span className="text-2xl font-bold font-mono text-amber-400">
                {stats.expectedLossA !== undefined ? formatPercent(stats.expectedLossA) : "—"}
              </span>
              <span className="text-[11px] text-white/40">Resiko konversi hilang jika memilih A</span>
            </div>
          </div>
        )}

        {/* Detailed Stats Table */}
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="min-w-full text-left text-sm text-white/80">
            <thead className="bg-white/10 text-xs uppercase text-white/60">
              <tr>
                <th className="px-6 py-3">Varian</th>
                <th className="px-6 py-3">Sample (Conv / Impr)</th>
                <th className="px-6 py-3">Mean Posterior</th>
                <th className="px-6 py-3">95% Credible Interval</th>
                <th className="px-6 py-3">P(V &gt; Baseline)</th>
                <th className="px-6 py-3">Expected Loss</th>
                <th className="px-6 py-3">Prob Best</th>
              </tr>
            </thead>
            <tbody>
              {stats.variants.map((variant) => {
                const isWinning = String(variant.id) === String(stats.winningVariantId);
                return (
                  <tr
                    key={String(variant.id)}
                    className={`border-t border-white/10 ${isWinning ? "bg-emerald-500/10" : ""}`}
                  >
                    <td className="px-6 py-3 font-medium text-white flex items-center gap-2">
                      <span>{variant.name}</span>
                      {isWinning && (
                        <span className="text-[10px] uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 rounded px-1.5 py-0.5 font-bold">
                          Winner
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      {formatNumber(variant.conversions)} / {formatNumber(variant.impressions)}
                    </td>
                    <td className="px-6 py-3 font-mono text-white">
                      {formatPercent(variant.mean)}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs text-white/70">
                      [{formatPercent(variant.credibleInterval95[0])} – {formatPercent(variant.credibleInterval95[1])}]
                    </td>
                    <td className="px-6 py-3 font-mono">
                      {formatPercent(variant.probBeatsBaseline)}
                    </td>
                    <td className="px-6 py-3 font-mono text-xs">
                      {formatPercent(variant.expectedLossVsBaseline)}
                    </td>
                    <td className="px-6 py-3 font-mono font-semibold text-emerald-400">
                      {formatPercent(variant.probIsBest)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
